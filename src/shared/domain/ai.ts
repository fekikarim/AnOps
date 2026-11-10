/**
 * Client-safe vocabulary of the AI Command Center: the modules a company can open to AI, the five
 * operations a grant can allow, and the presets an administrator can start from. No server code.
 */

export type AiOperation = "view" | "create" | "edit" | "delete" | "approve";
export type AiModuleKey = "inventory" | "purchasing" | "manufacturing" | "finance" | "marketing" | "hr" | "community";
export type AiModuleGrant = Record<AiOperation, boolean>;
export type AiModules = Partial<Record<AiModuleKey, AiModuleGrant>>;
export type AiRisk = "low" | "sensitive" | "destructive" | "financial";

export const AI_OPERATIONS: readonly AiOperation[] = ["view", "create", "edit", "delete", "approve"];

export const AI_MODULES: readonly AiModuleKey[] = [
  "inventory",
  "purchasing",
  "manufacturing",
  "finance",
  "marketing",
  "hr",
  "community",
];

export const AI_MODULE_LABELS: Record<AiModuleKey, string> = {
  inventory: "Inventory",
  purchasing: "Purchasing",
  manufacturing: "Manufacturing",
  finance: "Finance",
  marketing: "Marketing",
  hr: "HR",
  community: "Community",
};

export const AI_OPERATION_LABELS: Record<AiOperation, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
};

export function emptyModuleGrant(): AiModuleGrant {
  return { view: false, create: false, edit: false, delete: false, approve: false };
}

function grant(...operations: AiOperation[]): AiModuleGrant {
  const g = emptyModuleGrant();
  for (const operation of operations) g[operation] = true;
  return g;
}

export type AiPresetKey = "marketing" | "supply_chain" | "hr" | "finance" | "community" | "viewer";

export const AI_PRESETS: Record<AiPresetKey, { label: string; description: string; modules: AiModules }> = {
  marketing: {
    label: "Marketing",
    description: "Marketing tools only.",
    modules: { marketing: grant("view", "create", "edit") },
  },
  supply_chain: {
    label: "Inventory and supply chain",
    description: "Inventory, Purchasing and Manufacturing.",
    modules: {
      inventory: grant("view", "create", "edit"),
      purchasing: grant("view", "create", "edit"),
      manufacturing: grant("view", "create", "edit"),
    },
  },
  hr: {
    label: "HR",
    description: "People operations. Salary data needs the separate sensitive-data switch.",
    modules: { hr: grant("view", "create", "edit") },
  },
  finance: {
    label: "Finance",
    description: "Customers, invoices and expenses, within the person's finance permissions.",
    modules: { finance: grant("view", "create", "edit") },
  },
  community: {
    label: "Community",
    description: "Articles, forum and support chat. Publishing stays with owners and admins.",
    modules: { community: grant("view", "create", "edit") },
  },
  viewer: {
    label: "Read-only",
    description: "View access to every module.",
    modules: Object.fromEntries(AI_MODULES.map((m) => [m, grant("view")])) as AiModules,
  },
};

/** Modules that already have AI tools. Grants for the others can be saved but nothing is exposed yet. */
export const AI_MODULES_WITH_TOOLS: readonly AiModuleKey[] = ["inventory", "purchasing", "manufacturing", "finance", "hr", "marketing", "community"];
