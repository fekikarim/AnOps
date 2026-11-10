import "server-only";

import type { AiMessage, AiToolCall, AiToolDefinition } from "@/server/ai/types";

/** Groq and OpenRouter share the OpenAI chat format. These helpers map to and from it. */

type WireToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

export function toOpenAiMessages(messages: AiMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId ?? "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content,
        tool_calls: m.toolCalls.map((call) => ({
          id: call.id,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    if (m.role === "user" && m.attachments?.length) {
      return {
        role: "user" as const,
        content: [
          { type: "text" as const, text: m.content },
          ...m.attachments.map((a) => ({ type: "image_url" as const, image_url: { url: `data:${a.mimeType};base64,${a.dataBase64}` } })),
        ],
      };
    }
    return { role: m.role, content: m.content };
  });
}

export function toOpenAiTools(tools: AiToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export function fromOpenAiToolCalls(calls: WireToolCall[] | null | undefined): AiToolCall[] | undefined {
  if (!calls?.length) return undefined;
  return calls.map((call, index) => ({
    id: call.id || `call-${index}`,
    name: call.function?.name ?? "",
    arguments: call.function?.arguments || "{}",
  }));
}
