import { z } from "zod";
import { objectIdSchema } from "@/shared/lib/schema-primitives";
import { AI_MODULES, AI_OPERATIONS, type AiModuleGrant } from "@/shared/domain/ai";

const cell = z.boolean();

export const moduleGrantSchema: z.ZodType<AiModuleGrant> = z
  .object(Object.fromEntries(AI_OPERATIONS.map((op) => [op, cell])) as Record<(typeof AI_OPERATIONS)[number], typeof cell>)
  .strict();

export const modulesSchema = z
  .object(Object.fromEntries(AI_MODULES.map((m) => [m, moduleGrantSchema.optional()])) as Record<(typeof AI_MODULES)[number], z.ZodOptional<z.ZodType<AiModuleGrant>>>)
  .strict();

const MAX_TOKENS = 100_000_000;

export const memberGrantInputSchema = z
  .object({
    enabled: z.boolean(),
    modules: modulesSchema,
    canAuditTranscripts: z.boolean(),
    canViewSensitiveHr: z.boolean(),
    /** null uses the company default. */
    dailyTokenCap: z.number().int().min(0).max(MAX_TOKENS).nullable(),
  })
  .strict();

export type MemberGrantInput = z.infer<typeof memberGrantInputSchema>;

export const aiSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    retentionDays: z.number().int().min(7).max(730),
    /** 0 means no company-wide limit. */
    dailyTokenBudget: z.number().int().min(0).max(MAX_TOKENS),
    defaultUserDailyTokenCap: z.number().int().min(0).max(MAX_TOKENS),
  })
  .strict();

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

export const saveMemberGrantSchema = z.object({
  userId: objectIdSchema,
  expectedVersion: z.number().int().min(0),
  grant: memberGrantInputSchema,
});

export const saveSettingsSchema = z.object({
  expectedVersion: z.number().int().min(0),
  settings: aiSettingsInputSchema,
});

export const chatRequestSchema = z
  .object({
    conversationId: objectIdSchema.optional(),
    text: z.string().trim().min(1, "Write a message first.").max(2000, "Keep messages under 2000 characters."),
    /** A module copilot (for example the Finance Copilot) sees only that module's tools. */
    scope: z.enum(["finance"]).optional(),
    /** Which screen the person is on, such as "Invoice INV-2026-00012". Shown to the model as data only. */
    page: z.string().trim().max(160).optional(),
  })
  .strict();

export const confirmActionSchema = z
  .object({
    actionId: objectIdSchema,
    typedConfirmation: z.string().max(200).optional(),
  })
  .strict();
