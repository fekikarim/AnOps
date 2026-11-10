import "server-only";
import { groqApiKeyList } from "@/server/ai/config";

/**
 * Fetches the current available free models from each configured AI provider.
 * Used by /api/ai/models — never import this in client components.
 */

export type ProviderModel = {
  id: string;
  label: string;
};

export type ProviderModels = {
  id: string;
  label: string;
  icon: string;
  available: boolean;
  models: ProviderModel[];
  error?: string;
};

// ─── Groq ────────────────────────────────────────────────────────────────────
// Docs: https://console.groq.com/docs/openai  →  GET /openai/v1/models
// Response: { data: [{ id, owned_by, ... }] }

async function fetchGroqModels(): Promise<ProviderModels> {
  const keys = (groqApiKeyList() ?? "").split(",").map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0) {
    return { id: "groq", label: "Groq", icon: "🔥", available: false, models: [], error: "No API key configured" };
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${keys[0]}` },
      next: { revalidate: 300 }, // cache 5 min
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as { data: Array<{ id: string; owned_by?: string }> };

    // Filter to chat models only (skip whisper / tts / guards)
    const chatModels = json.data
      .filter((m) =>
        !m.id.includes("whisper") &&
        !m.id.includes("tts") &&
        !m.id.includes("guard") &&
        !m.id.includes("safeguard")
      )
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({
        id: m.id,
        label: formatGroqLabel(m.id),
      }));

    return {
      id: "groq",
      label: "Groq",
      icon: "🔥",
      available: true,
      models: chatModels.length > 0 ? chatModels : [
        { id: "openai/gpt-oss-120b", label: "OpenAI GPT OSS 120B" },
        { id: "openai/gpt-oss-20b", label: "OpenAI GPT OSS 20B" },
        { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
        { id: "allam-2-7b", label: "Allam 2 7B" },
      ],
    };
  } catch (err) {
    return {
      id: "groq",
      label: "Groq",
      icon: "🔥",
      available: true,
      models: [
        { id: "openai/gpt-oss-120b", label: "OpenAI GPT OSS 120B" },
        { id: "openai/gpt-oss-20b", label: "OpenAI GPT OSS 20B" },
        { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
        { id: "allam-2-7b", label: "Allam 2 7B" },
      ],
      error: (err as Error).message,
    };
  }
}

function formatGroqLabel(id: string): string {
  // "llama-3.3-70b-versatile" → "Llama 3.3 70B Versatile"
  return id
    .replace(/-/g, " ")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────
// Docs: https://openrouter.ai/docs/api-reference/list-available-models
// No auth needed for listing. Filter: pricing.prompt === "0"

async function fetchOpenRouterModels(): Promise<ProviderModels> {
  const key = process.env.OPENROUTER_API_KEY?.trim();

  if (!key) {
    return { id: "openrouter", label: "OpenRouter", icon: "🌐", available: false, models: [], error: "No API key configured" };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": process.env.NEXTAUTH_URL ?? "http://localhost:3000",
      },
      next: { revalidate: 300 },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as {
      data: Array<{
        id: string;
        name: string;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };

    // Free models: prompt price is "0" or model id ends with ":free"
    const freeModels = json.data
      .filter(
        (m) =>
          (m.id.endsWith(":free") || m.pricing?.prompt === "0") &&
          !m.id.includes("safety")
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({
        id: m.id,
        label: m.name.replace(/\s*\(free\)/i, "").trim(),
      }));

    return {
      id: "openrouter",
      label: "OpenRouter",
      icon: "🌐",
      available: true,
      models: freeModels.length > 0 ? freeModels : [
        { id: "nvidia/nemotron-3.5-lightning:free", label: "NVIDIA Nemotron 3.5 Lightning" },
        { id: "liquid/lfm-2.5-2.6b:free", label: "Liquid LFM 2.5 2.6B" },
        { id: "thinkingmachines/inkling-small:free", label: "ThinkingMachines Inkling Small" },
        { id: "poolside/laguna-s-2.1:free", label: "Poolside Laguna S 2.1" },
        { id: "recursive/flint-v1.0:free", label: "Recursive Flint v1.0" },
      ],
    };
  } catch (err) {
    return {
      id: "openrouter",
      label: "OpenRouter",
      icon: "🌐",
      available: true,
      models: [
        { id: "nvidia/nemotron-3.5-lightning:free", label: "NVIDIA Nemotron 3.5 Lightning" },
        { id: "liquid/lfm-2.5-2.6b:free", label: "Liquid LFM 2.5 2.6B" },
        { id: "thinkingmachines/inkling-small:free", label: "ThinkingMachines Inkling Small" },
        { id: "poolside/laguna-s-2.1:free", label: "Poolside Laguna S 2.1" },
        { id: "recursive/flint-v1.0:free", label: "Recursive Flint v1.0" },
      ],
      error: (err as Error).message,
    };
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
// Docs: https://ai.google.dev/api/models#v1beta.models.list
// GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY

async function fetchGeminiModels(): Promise<ProviderModels> {
  const keysRaw = process.env.GEMINI_API_KEYS ?? "";
  const keys = keysRaw.split(",").map((k) => k.trim()).filter(Boolean);

  if (keys.length === 0) {
    return { id: "gemini", label: "Gemini", icon: "✨", available: false, models: [], error: "No API key configured" };
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${keys[0]}`,
      { next: { revalidate: 300 } }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json() as {
      models: Array<{
        name: string;        // "models/gemini-2.5-flash"
        displayName: string;
        supportedGenerationMethods?: string[];
      }>;
    };

    // Keep only models that support generateContent and are general text/chat models
    const chatModels = (json.models ?? [])
      .filter(
        (m) =>
          m.supportedGenerationMethods?.includes("generateContent") &&
          !m.name.includes("tts") &&
          !m.name.includes("image") &&
          !m.name.includes("clip") &&
          !m.name.includes("robotics") &&
          !m.name.includes("deep-research") &&
          !m.name.includes("transcribe") &&
          !m.name.includes("computer-use")
      )
      .map((m) => ({
        id: m.name.replace(/^models\//, ""),
        label: m.displayName,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      id: "gemini",
      label: "Gemini",
      icon: "✨",
      available: true,
      models: chatModels.length > 0 ? chatModels : [
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
        { id: "gemini-flash-latest", label: "Gemini Flash Latest" },
        { id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B IT" },
      ],
    };
  } catch (err) {
    return {
      id: "gemini",
      label: "Gemini",
      icon: "✨",
      available: true,
      models: [
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
        { id: "gemini-flash-latest", label: "Gemini Flash Latest" },
        { id: "gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B IT" },
      ],
      error: (err as Error).message,
    };
  }
}

// ─── Master fetch ─────────────────────────────────────────────────────────────

export async function fetchAllProviderModels(): Promise<ProviderModels[]> {
  const [groq, openrouter, gemini] = await Promise.allSettled([
    fetchGroqModels(),
    fetchOpenRouterModels(),
    fetchGeminiModels(),
  ]);

  return [
    groq.status === "fulfilled" ? groq.value : { id: "groq", label: "Groq", icon: "🔥", available: false, models: [], error: "Failed" },
    openrouter.status === "fulfilled" ? openrouter.value : { id: "openrouter", label: "OpenRouter", icon: "🌐", available: false, models: [], error: "Failed" },
    gemini.status === "fulfilled" ? gemini.value : { id: "gemini", label: "Gemini", icon: "✨", available: false, models: [], error: "Failed" },
  ];
}
