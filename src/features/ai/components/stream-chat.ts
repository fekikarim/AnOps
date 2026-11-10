import type { AiMessagePart } from "@/server/db/documents";

export type StreamEvent =
  | { type: "conversation"; conversationId: string }
  | { type: "part"; part: AiMessagePart }
  | { type: "text"; text: string }
  | { type: "done"; conversationId: string }
  | { type: "error"; code: string; message: string };

export class ChatRequestError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * Sends one message and reports each server-sent event as it arrives. A failure before the stream
 * starts (signed out, no access, invalid message) comes back as JSON and is thrown as ChatRequestError.
 */
export async function streamChat(
  body: { text: string; conversationId?: string; scope?: "finance"; page?: string },
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch("/api/v1/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    let code = "INTERNAL";
    let message = "Something went wrong. Please try again.";
    try {
      const json = (await response.json()) as { error?: { code?: string; message?: string } };
      code = json.error?.code ?? code;
      message = json.error?.message ?? message;
    } catch {
      /* keep the generic copy */
    }
    throw new ChatRequestError(code, message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (data) {
        try {
          onEvent(JSON.parse(data.slice(6)) as StreamEvent);
        } catch {
          /* ignore a malformed frame rather than breaking the stream */
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
