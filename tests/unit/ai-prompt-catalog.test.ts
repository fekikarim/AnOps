import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aiToolRegistry } from "@/server/ai/tools";
import { scopeTools, toolCatalog, toolSignature } from "@/server/ai/tools/prompt-catalog";
import { objectIdSchema } from "@/shared/lib/schema-primitives";

describe("the tool list given to the model", () => {
  it("keeps what a call needs: required vs optional arguments, enum values, ids, nested arrays", () => {
    const sig = toolSignature({
      name: "demo_tool",
      kind: "write",
      description: "Does a thing.",
      input: z.object({ id: objectIdSchema, status: z.enum(["a", "b"]).optional(), note: z.string().max(50).optional(), lines: z.array(z.object({ productId: objectIdSchema, quantity: z.union([z.string(), z.number()]) }).strict()) }).strict(),
    });
    expect(sig).toBe("- demo_tool [write] Does a thing.\n  args {id:id,status?:a|b,note?:string,lines:{productId:id,quantity:string|number}[]}");
  });

  it("stays within a budget the smallest provider limit can take, so adding a module cannot silently break chat", () => {
    const text = toolCatalog(aiToolRegistry.all());
    for (const tool of aiToolRegistry.all()) expect(text, tool.name).toContain(`- ${tool.name} [${tool.kind}]`);
    // The full list is no longer sent (it passed 5k tokens with five modules; raw JSON Schema returned HTTP 413). What a request
    // sends is core plus the modules it mentions, and that has to stay small whichever module it is.
    for (const probe of ["invoice", "stock", "purchase order", "bill of materials", "employee leave", "marketing campaign", "community article"]) {
      const scoped = toolCatalog(scopeTools([...aiToolRegistry.all()], [probe]));
      expect(Math.ceil(scoped.length / 4), probe).toBeLessThan(3200);
    }
  });

  it("never shows schema noise or identity fields", () => {
    const text = toolCatalog(aiToolRegistry.all());
    expect(text).not.toMatch(/additionalProperties|maxLength|\$schema|companyId|userId/);
  });
});

describe("describing only the modules a conversation is about", () => {
  const all = [...aiToolRegistry.all()];
  const modules = (texts: string[]) => [...new Set(scopeTools(all, texts).map((t) => t.module))].sort();

  it("a finance request describes core and finance tools only, in English or French", () => {
    expect(modules(["Invoice Atlas Foods for 12 bottles"])).toEqual(["core", "finance"]);
    expect(modules(["Montre-moi les factures impayées du client Atlas"])).toEqual(["core", "finance"]);
    expect(modules(["record a payment of 100 TND"])).toEqual(["core", "finance"]);
  });
  it("a request that spans modules describes each of them", () => {
    expect(modules(["Which suppliers do I have, and who owes me money?"])).toEqual(["core", "finance", "purchasing"]);
    expect(modules(["Check the bill of materials, then stock levels"])).toEqual(["core", "inventory", "manufacturing"]);
  });
  it("a follow-up like 'yes, do it' keeps the module of the recent conversation", () => {
    expect(modules(["yes, post it", "Create an invoice for Atlas Foods"])).toEqual(["core", "finance"]);
  });
  it("a general question describes the read tools of every module and no writes", () => {
    const scoped = scopeTools(all, ["What can you do?"]);
    expect(scoped.every((t) => t.module === "core" || t.kind === "read")).toBe(true);
    expect(new Set(scoped.map((t) => t.module)).size).toBeGreaterThan(3);
  });
  it("the scoped prompt is far smaller than the full one, and never adds a tool that was not available", () => {
    const scoped = scopeTools(all, ["Create an invoice"]);
    expect(toolCatalog(scoped).length).toBeLessThan(toolCatalog(all).length / 2);
    expect(scoped.every((t) => all.includes(t))).toBe(true);
  });
  it("a small registry is described in full", () => {
    const small = all.filter((t) => t.module === "core");
    expect(scopeTools(small, ["anything"])).toEqual(small);
  });
});
