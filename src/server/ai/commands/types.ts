import "server-only";
import type { ZodType } from "zod";
import type { ObjectId } from "mongodb";
import type { AiAccess } from "@/server/ai/access/access.service";
import type { ToolRegistry } from "@/server/ai/tools/registry";
import type { AiFormField, AiMessagePart, AiProvenance } from "@/server/db/documents";
import type { Permission } from "@/server/security/permissions";
import type { WorkspaceContext } from "@/server/tenancy/workspace";
import type { AiModuleKey, AiOperation } from "@/shared/domain/ai";

/**
 * Slash commands are deterministic: they skip the model and drive the same tools through guided
 * steps (pick a record, fill a form, confirm). The runner re-resolves the member's live access before
 * every step, and every step's arguments are validated on the server whatever the client sent.
 */
export type CommandArgs = Record<string, string | number | boolean>;

export type CommandEnv = {
  /** Built from the LIVE role and permissions, never the ones from the start of the request. */
  ctx: WorkspaceContext;
  access: AiAccess;
  registry: ToolRegistry;
  conversationId: ObjectId | null;
};

export type CommandResult = { parts: AiMessagePart[]; text?: string };

/** A real record the engine may act on. Only ever produced by searching company data through the module's own services. */
export type DraftCandidate = { id: string; label: string; detail: string };
export type DraftCurrent = { id: string; label: string; values: Record<string, string | boolean>; version?: number };

/**
 * What a command declares to offer AI-assisted entry. The form fields are the SAME ones the manual
 * form uses, so the AI draft is simply a prefilled, annotated version of that form and submits
 * through the same step, proposal and confirmation as manual entry.
 */
/** How a line-item field (order lines, BOM components) is resolved against real records. */
export type DraftLinesSpec = {
  /** The form field that holds the rows. */
  field: string;
  /** The column that identifies the record on each row (a product id). */
  keyColumn: string;
  /** Columns that must have a value on every row. */
  requiredColumns: string[];
  /** Columns the model may never assume: quantities and prices. */
  criticalColumns: string[];
  /** Real records the words could mean. Searching company data only; never model-supplied ids. */
  find: (env: CommandEnv, ref: string, current: DraftCurrent | null) => Promise<DraftCandidate[]>;
  /** One real record by id, or null. Used when a chat write already carries ids, so they are verified rather than trusted. */
  byId: (env: CommandEnv, id: string, current: DraftCurrent | null) => Promise<DraftCandidate | null>;
  /** Rows come from the record being acted on (receipt lines): the AI may fill quantities but never add a row. */
  fixedRows?: boolean;
  /** A new row for a matched record, with defaults taken from the record itself (its standard cost, its unit). */
  newRow: (env: CommandEnv, candidate: DraftCandidate) => Promise<{ row: Record<string, string>; provenance: Record<string, AiProvenance> }>;
};

/** A select whose options are too many to show a model: the model names the record in words and the server resolves it. */
export type DraftRefSpec = {
  find: (env: CommandEnv, words: string, current: DraftCurrent | null) => Promise<DraftCandidate[]>;
  byId: (env: CommandEnv, id: string, current: DraftCurrent | null) => Promise<DraftCandidate | null>;
};

export type DraftSpec = {
  lines?: DraftLinesSpec;
  /** Fields resolved by search instead of a closed option list, keyed by field name. Never assumed: the person must name them. */
  refFields?: Record<string, DraftRefSpec>;
  kind: "create" | "edit";
  /** "product": used in prompts and questions. */
  noun: string;
  /** Overrides the default titles for actions that are not plain create/edit, for example "Receive stock". */
  action?: string;
  /** Extra instructions for the model about this kind of record (for example, that it should write the message text itself). */
  guidance?: string;
  /** One example sentence shown to the person. */
  examples: string[];
  /** The write tool this ends in. Lets a natural-language chat request land in the same draft card. */
  tool: string;
  /** Fields where the model may not assume a value (money, quantities, ids). Missing means ask. */
  criticalFields: string[];
  fields: (env: CommandEnv, current: DraftCurrent | null) => Promise<AiFormField[]>;
  /** What the submit step needs back (ids, versions). */
  context?: (current: DraftCurrent) => Record<string, string | number | boolean>;
  target?: {
    /** "product": the record the change applies to. */
    label: string;
    /** The form-context key that holds its id on submit. */
    key: string;
    search: (env: CommandEnv, text: string) => Promise<DraftCandidate[]>;
    load: (env: CommandEnv, id: string) => Promise<DraftCurrent>;
  };
  /** Chat integration: turns a write tool's arguments into form values (default: same names). */
  fromToolArgs?: (args: Record<string, unknown>) => { targetId?: string; values: Record<string, unknown> };
};

export type DraftInput = {
  text: string;
  /** Current form values, for conversational refinement. */
  values: Record<string, string | number | boolean>;
  provenance: Record<string, AiProvenance>;
  lineProvenance?: Record<string, Record<string, AiProvenance>[]>;
};

export type CommandDefinition = {
  /** Without the slash, lower case: "products". */
  name: string;
  description: string;
  example: string;
  module: AiModuleKey | "core";
  operation: AiOperation;
  /** The exact permission the underlying service asserts. null for core commands. */
  permission: Permission | null;
  /** Needs the separate sensitive-HR switch on the member's AI grant, on top of the module cell. */
  sensitive?: "hr";
  /** Reached only from a row or card action, so not listed in the palette. */
  hidden?: boolean;
  /** Validates the args that arrive with any step (start args, the selected id, the form context). */
  args: ZodType<CommandArgs>;
  /** Turns "/products bolt" into args. */
  fromText: (rest: string) => Record<string, unknown>;
  start: (env: CommandEnv, args: CommandArgs) => Promise<CommandResult>;
  select?: (env: CommandEnv, args: CommandArgs) => Promise<CommandResult>;
  submit?: (env: CommandEnv, args: CommandArgs, values: Record<string, string | number | boolean>) => Promise<CommandResult>;
  /** Present when the command can also be done by describing it to the AI. `start` then offers the choice; `manual` is the original start. */
  draft?: DraftSpec;
  manual?: (env: CommandEnv, args: CommandArgs) => Promise<CommandResult>;
};
