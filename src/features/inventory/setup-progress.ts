/**
 * Guided inventory setup: which steps exist, which are finished and what to do next.
 *
 * Progress is never stored. It is derived from the records that really exist, so an interrupted
 * setup resumes exactly where the data left off, and doing a step outside the wizard (for example
 * adding a warehouse from the Warehouses tab) still counts. Keep this file free of server-only imports.
 */

export type SetupCounts = {
  warehouses: number;
  categories: number;
  products: number;
  /** Active products that hold stock (isStorable). */
  storableProducts: number;
  /** Active storable products with more than zero on hand somewhere. */
  productsWithStock: number;
  suppliers: number;
};

export const SETUP_STEP_IDS = ["warehouse", "categories", "products", "stock", "suppliers", "review"] as const;
export type SetupStepId = (typeof SETUP_STEP_IDS)[number];

export type SetupStepStatus = "done" | "todo" | "blocked";

export type SetupStep = {
  id: SetupStepId;
  title: string;
  /** Required steps are needed before the module is useful. Optional steps are offered, never forced. */
  required: boolean;
  status: SetupStepStatus;
  /** The step that has to be finished first, when blocked. */
  blockedBy: SetupStepId | null;
  /** One sentence on the current state, for the checklist. */
  summary: string;
};

export type SetupProgress = {
  steps: SetupStep[];
  requiredDone: number;
  requiredTotal: number;
  /** 0-100 across all steps except the review. */
  percent: number;
  /** First step that is not done and not blocked, or "review" once everything is configured. */
  nextStepId: SetupStepId;
  /** True when the required steps are done: inventory is usable even if optional steps remain. */
  isUsable: boolean;
  /** True when every step before the review is done. */
  isComplete: boolean;
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function buildSetupProgress(counts: SetupCounts): SetupProgress {
  const hasWarehouse = counts.warehouses > 0;
  const hasProducts = counts.products > 0;

  const steps: SetupStep[] = [
    {
      id: "warehouse",
      title: "Where you keep stock",
      required: true,
      status: hasWarehouse ? "done" : "todo",
      blockedBy: null,
      summary: hasWarehouse ? `${plural(counts.warehouses, "warehouse")} ready.` : "Add the place where your goods are stored.",
    },
    {
      id: "categories",
      title: "Product categories",
      required: false,
      status: counts.categories > 0 ? "done" : "todo",
      blockedBy: null,
      summary: counts.categories > 0 ? `${plural(counts.categories, "category", "categories")} created.` : "Optional. Group products to find and report on them faster.",
    },
    {
      id: "products",
      title: "Your products",
      required: true,
      status: hasProducts ? "done" : "todo",
      blockedBy: null,
      summary: hasProducts ? `${plural(counts.products, "product")} added.` : "Add what you buy, make or sell.",
    },
    {
      id: "stock",
      title: "Opening stock",
      required: false,
      status: !hasProducts || !hasWarehouse ? "blocked" : counts.storableProducts === 0 || counts.productsWithStock > 0 ? "done" : "todo",
      blockedBy: !hasWarehouse ? "warehouse" : !hasProducts ? "products" : null,
      summary: !hasWarehouse
        ? "Needs a warehouse first."
        : !hasProducts
          ? "Needs a product first."
          : counts.storableProducts === 0
            ? "None of your products hold stock."
            : counts.productsWithStock > 0
              ? `${counts.productsWithStock} of ${plural(counts.storableProducts, "stocked product")} have quantities.`
              : "Record what you already have on the shelves.",
    },
    {
      id: "suppliers",
      title: "Suppliers",
      required: false,
      status: counts.suppliers > 0 ? "done" : "todo",
      blockedBy: null,
      summary: counts.suppliers > 0 ? `${plural(counts.suppliers, "supplier")} saved.` : "Optional. Needed to place purchase orders.",
    },
  ];

  // A copy: the review step is appended to `steps` below and must not count toward the percentage.
  const main = [...steps];
  const requiredSteps = main.filter((step) => step.required);
  const requiredDone = requiredSteps.filter((step) => step.status === "done").length;
  const doneCount = main.filter((step) => step.status === "done").length;
  const isComplete = doneCount === main.length;
  const next = main.find((step) => step.status === "todo");

  steps.push({
    id: "review",
    title: "Review and finish",
    required: false,
    status: isComplete ? "done" : "todo",
    blockedBy: null,
    summary: isComplete ? "Everything is configured." : "See what is set up and what remains.",
  });

  return {
    steps,
    requiredDone,
    requiredTotal: requiredSteps.length,
    percent: Math.round((doneCount / main.length) * 100),
    nextStepId: next ? next.id : "review",
    isUsable: requiredDone === requiredSteps.length,
    isComplete,
  };
}

export function isSetupStepId(value: string | undefined | null): value is SetupStepId {
  return typeof value === "string" && (SETUP_STEP_IDS as readonly string[]).includes(value);
}
