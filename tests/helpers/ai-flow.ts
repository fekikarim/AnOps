import { vi } from "vitest";
import type { AiMessagePart } from "@/server/db/documents";
import { resolveAiAccess } from "@/server/ai/access/access.service";
import { runCommandStep } from "@/server/ai/command-runner";
import { confirmAction, proposeAction } from "@/server/ai/pending-actions.service";
import type { CompleteFn } from "@/server/ai/structured-completion";
import { aiToolRegistry } from "@/server/ai/tools";
import { isToolAvailable } from "@/server/ai/tools/registry";
import { actorOf, wsOf, type SeededMember } from "./ai";
import type { TestHarness } from "./workspace";

export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}

/** A scripted model: each call returns the next reply (an object is sent as JSON, an Error is thrown). */
export function llm(...replies: (object | string | Error)[]) {
  let i = 0;
  const calls = vi.fn();
  const complete: CompleteFn = async (options) => {
    calls(options);
    const next = replies[Math.min(i++, replies.length - 1)];
    if (next instanceof Error) throw next;
    return { text: typeof next === "string" ? next : JSON.stringify(next), provider: "Groq", model: "test", usage: { totalTokens: 30 } };
  };
  return { complete, calls };
}

export const kind = <K extends AiMessagePart["type"]>(ps: AiMessagePart[], type: K) => ps.find((p) => p.type === type) as Extract<AiMessagePart, { type: K }>;
export const stated = (value: string | number, evidence: string) => ({ value, basis: "stated", evidence });
export const formValues = (f: Extract<AiMessagePart, { type: "form" }>) => Object.fromEntries(f.fields.map((x) => [x.name, x.value as string | boolean]));
export const fieldValue = (f: Extract<AiMessagePart, { type: "form" }>, name: string) => f.fields.find((x) => x.name === name)?.value;

/** Everything a test needs to act as a member: commands, tool proposals, confirmations and direct reads. */
export function flow(getHarness: () => TestHarness) {
  type Member = SeededMember;
  const h = () => getHarness();
  return {
    step: (member: Member, body: object, complete?: CompleteFn) => runCommandStep(wsOf(h(), member), body, { complete }),
    async parts(member: Member, body: object, complete?: CompleteFn) {
      return (await runCommandStep(wsOf(h(), member), body, { complete })).parts;
    },
    async propose(member: Member, tool: string, args: unknown) {
      const access = await resolveAiAccess(actorOf(h(), member));
      return proposeAction(wsOf(h(), member), access, aiToolRegistry, { toolName: tool, rawArgs: args, conversationId: null });
    },
    confirm: (member: Member, actionId: string, typedConfirmation?: string) => confirmAction(wsOf(h(), member), aiToolRegistry, { actionId, typedConfirmation }),
    async read(member: Member, name: string, args: unknown = {}) {
      const access = await resolveAiAccess(actorOf(h(), member));
      const tool = aiToolRegistry.get(name)!;
      if (!isToolAvailable(tool, access)) throw Object.assign(new Error("unavailable"), { code: "UNAVAILABLE" });
      return tool.run({ ...wsOf(h(), member), role: access.member!.role, permissions: access.member!.permissions }, tool.input.parse(args), { access }, {});
    },
  };
}
