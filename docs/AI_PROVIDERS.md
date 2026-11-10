# AnOps AI Provider System

> **Rule:** Every AI feature in AnOps **must** import from `@/server/ai` — never instantiate a provider SDK directly.

---

## Overview

AnOps ships a unified AI provider master (`src/server/ai/`) that abstracts over multiple free-tier LLM providers. It handles key rotation, rate-limit fallback, and provider failover transparently so feature code stays simple.

```
Feature code
    └─► import { ai } from "@/server/ai"
            └─► AiMaster (router)
                    ├─► GroqProvider       (GROQ_API_KEYS)
                    ├─► OpenRouterProvider (OPENROUTER_API_KEY)
                    └─► GeminiProvider     (GEMINI_API_KEYS)
```

---

## Provider Priority

| Priority | Provider | Free Models (default first) | Key Env Var |
|---|---|---|---|
| 1 | **Groq** | `llama-3.3-70b-versatile`, `llama3-8b-8192`, `mixtral-8x7b-32768`, `gemma2-9b-it` | `GROQ_API_KEYS` |
| 2 | **OpenRouter** | `meta-llama/llama-3.3-70b-instruct:free`, `google/gemma-3-27b-it:free`, `deepseek/deepseek-r1:free` | `OPENROUTER_API_KEY` |
| 3 | **Gemini** | `gemma-3-27b-it`, `gemma-3-12b-it`, `gemini-2.0-flash`, `gemini-1.5-flash` | `GEMINI_API_KEYS` |

The master tries providers in this order and falls back automatically on any failure.

---

## Key Rotation (Groq & Gemini)

`GROQ_API_KEYS` and `GEMINI_API_KEYS` accept **comma-separated lists** of API keys:

```env
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3
GEMINI_API_KEYS=AIza_key1,AIza_key2
```

The `KeyPool` class in `src/server/ai/key-pool.ts`:
- Maintains a rotating cursor across all keys
- On a **429 response**, marks the offending key as rate-limited for **60 seconds**
- Automatically selects the next available key on the next request
- Retries up to **3 times per call** before failing over to the next provider

---

## File Structure

```
src/server/ai/
├── index.ts                    <- THE ONLY IMPORT FEATURES SHOULD USE
├── types.ts                    <- AiProvider interface, AiMessage, AiCompletionOptions, AiCompletionResult
├── key-pool.ts                 <- Generic rotating key pool with 429 cooldown
└── providers/
    ├── groq.provider.ts        <- Groq SDK adapter (multi-key rotation)
    ├── openrouter.provider.ts  <- OpenRouter REST adapter (free models)
    └── gemini.provider.ts      <- Google Generative AI adapter (Gemma family)
```

---

## Usage

### Simple prompt

```typescript
import { ai } from "@/server/ai";

// One-shot question (system prompt optional)
const summary = await ai.ask(
  "Summarise this attendance report: ...",
  "You are an HR analytics assistant. Be concise."
);
```

### Full conversation

```typescript
import { ai } from "@/server/ai";

const result = await ai.complete({
  messages: [
    { role: "system", content: "You are an HR assistant for AnOps." },
    { role: "user",   content: "What are common causes of absenteeism?" },
  ],
  maxTokens: 512,
  temperature: 0.5,
});

console.log(result.text);     // generated response
console.log(result.provider); // which provider answered
console.log(result.model);    // which model was used
```

### Force a specific model

```typescript
const result = await ai.complete({
  messages: [...],
  model: "gemma-3-27b-it",
});
```

### Health check (for admin dashboards)

```typescript
import { ai } from "@/server/ai";

const status = ai.status();
// [{ name: "Groq", available: true, models: [...] }, ...]
```

---

## Environment Variables

Add to your `.env`:

```env
# Groq -- https://console.groq.com (multiple keys recommended)
GROQ_API_KEYS=gsk_key1,gsk_key2,gsk_key3

# OpenRouter -- https://openrouter.ai
OPENROUTER_API_KEY=sk-or-v1-xxx

# Google Gemini -- https://aistudio.google.com
GEMINI_API_KEYS=AIza_key1,AIza_key2
```

You do **not** need all three -- any combination works. The master skips unconfigured providers.

---

## Adding a New Provider

1. Create `src/server/ai/providers/myprovider.provider.ts`
2. Implement the `AiProvider` interface from `@/server/ai/types`
3. Register it in `AiMaster` constructor in `src/server/ai/index.ts`

```typescript
interface AiProvider {
  readonly name: string;
  readonly isAvailable: boolean;
  readonly freeModels: string[];
  complete(options: AiCompletionOptions): Promise<AiCompletionResult>;
}
```

---

## Rules for Feature Developers

- Always import from `@/server/ai` -- never from individual provider files
- Use `ai.ask()` for simple one-shot prompts
- Use `ai.complete()` for multi-turn or when you need metadata (provider, model, usage)
- Never instantiate `GroqProvider`, `GeminiProvider`, or `OpenRouterProvider` directly
- Never call `new Groq(...)`, `new GoogleGenerativeAI(...)`, or fetch OpenRouter directly
- Never hardcode API keys -- always read from env via the provider constructors
- Never import `@/server/ai` in client components -- it is server-only (`import "server-only"`)

---

## Task routing and tool calling

Use `ai.chat()` when you need tool calling or a task-specific provider order:

```typescript
const result = await ai.chat({
  taskType: "copilot_chat", // or "advisor_json", "policy_qa"
  messages,
  tools,            // optional: { name, description, parameters (JSON schema) }[]
  jsonObject: true, // optional: ask for JSON. Always validate the output.
});
// result: text, toolCalls, provider, model, usage, latencyMs, fallbacks
```

| Task | Provider order | Override with |
|---|---|---|
| `copilot_chat` | Groq → OpenRouter → Gemini | `AI_ROUTE_COPILOT_CHAT` |
| `advisor_json` | Gemini → Groq → OpenRouter | `AI_ROUTE_ADVISOR_JSON` |
| `policy_qa` | Gemini → Groq → OpenRouter | `AI_ROUTE_POLICY_QA` |

Timeouts (25s), 429/5xx, empty responses and malformed tool arguments move to the next provider, with at most one retry per provider. `AI_DISABLED_PROVIDERS=groq` skips a provider, to rehearse an outage. Pass `economy: true` to limit hidden reasoning (Groq `gpt-oss`: low effort; Gemini 2.5: no thinking budget). Without it, Gemini 2.5 counts thinking against `maxTokens`, and a small limit truncates the answer. Providers also count `maxTokens` against rate limits, so keep it small.

---

## Error Handling

The master throws a plain `Error` only if **all** configured providers fail:

```typescript
try {
  const text = await ai.ask("...");
  return { ok: true, text };
} catch (err) {
  console.error("[MyAction] AI failed:", err);
  return { ok: false, error: "AI is temporarily unavailable." };
}
```
