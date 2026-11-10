import "server-only";
import { createToolRegistry } from "@/server/ai/tools/registry";
import { CORE_TOOLS } from "@/server/ai/tools/core.tools";
import { INVENTORY_TOOLS } from "@/server/ai/tools/inventory.tools";
import { PURCHASING_TOOLS } from "@/server/ai/tools/purchasing.tools";
import { MANUFACTURING_TOOLS } from "@/server/ai/tools/manufacturing.tools";
import { FINANCE_TOOLS } from "@/server/ai/tools/finance.tools";
import { FINANCE_INSIGHT_TOOLS } from "@/server/ai/tools/finance-insights.tools";
import { HR_TOOLS } from "@/server/ai/tools/hr.tools";
import { MARKETING_TOOLS } from "@/server/ai/tools/marketing.tools";
import { COMMUNITY_TOOLS } from "@/server/ai/tools/community.tools";

/**
 * The production registry. Module tools are appended here phase by phase; each module's tools live
 * in their own file and import only that module's services.
 */
export const aiToolRegistry = createToolRegistry([...CORE_TOOLS, ...INVENTORY_TOOLS, ...PURCHASING_TOOLS, ...MANUFACTURING_TOOLS, ...FINANCE_TOOLS, ...FINANCE_INSIGHT_TOOLS, ...HR_TOOLS, ...MARKETING_TOOLS, ...COMMUNITY_TOOLS]);
