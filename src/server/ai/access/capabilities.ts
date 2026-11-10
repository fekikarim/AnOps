import { PERMISSIONS, type Permission } from "@/server/security/permissions";
import {
  AI_MODULES,
  AI_OPERATIONS,
  emptyModuleGrant,
  type AiModuleGrant,
  type AiModuleKey,
  type AiModules,
  type AiOperation,
} from "@/shared/domain/ai";

export { AI_MODULES, AI_OPERATIONS, emptyModuleGrant };

/**
 * Pure capability model for the AI Command Center. No database access here.
 *
 * Effective capability = what the company granted this member for AI AND what the member's AnOps
 * role already allows. The ceiling below is the second half: a grant cell may never be on when the
 * member's role lacks the permission behind it. Individual tools still assert their own exact
 * permission, so the ceiling is a coarse gate rather than the only one.
 */

/** Role permission behind each (module, operation). null means the operation does not exist for that module. */
const CEILING: Record<AiModuleKey, Record<AiOperation, Permission | null>> = {
  inventory: {
    view: PERMISSIONS.INVENTORY_READ,
    create: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    edit: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    delete: PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    approve: PERMISSIONS.INVENTORY_STOCK_ADJUST,
  },
  purchasing: {
    view: PERMISSIONS.PURCHASING_READ,
    create: PERMISSIONS.PURCHASING_ORDER_MANAGE,
    edit: PERMISSIONS.PURCHASING_ORDER_MANAGE,
    delete: PERMISSIONS.PURCHASING_ORDER_MANAGE,
    approve: PERMISSIONS.PURCHASING_ORDER_APPROVE,
  },
  manufacturing: {
    view: PERMISSIONS.MANUFACTURING_READ,
    create: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
    edit: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
    delete: PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
    approve: PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE,
  },
  finance: {
    view: PERMISSIONS.FINANCE_READ,
    create: PERMISSIONS.FINANCE_INVOICE_MANAGE,
    edit: PERMISSIONS.FINANCE_INVOICE_MANAGE,
    delete: PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
    approve: PERMISSIONS.FINANCE_EXPENSE_APPROVE,
  },
  // Drafts follow the manager's real marketing permissions. Approving and scheduling a campaign, and anything destructive,
  // is owner/admin only through marketing.admin (managers hold marketing.manage permissions but never approve or dispatch).
  marketing: {
    view: PERMISSIONS.MARKETING_READ,
    create: PERMISSIONS.MARKETING_CONTACT_MANAGE,
    edit: PERMISSIONS.MARKETING_CONTACT_MANAGE,
    delete: PERMISSIONS.MARKETING_ADMIN,
    approve: PERMISSIONS.MARKETING_ADMIN,
  },
  // Drafts follow the operator's real Community permission. Publishing, archiving and pinning (approve) are owner/admin only
  // through community.admin. Deletion is not available to AI at all, so its cell is never granted.
  community: {
    view: PERMISSIONS.COMMUNITY_READ,
    create: PERMISSIONS.COMMUNITY_WRITE,
    edit: PERMISSIONS.COMMUNITY_WRITE,
    delete: PERMISSIONS.COMMUNITY_ADMIN,
    approve: PERMISSIONS.COMMUNITY_ADMIN,
  },
  // HR writes are owner/admin only, as in the HR server actions. hr.manage is also held by managers, so it is not the ceiling.
  hr: {
    view: PERMISSIONS.HR_READ,
    create: PERMISSIONS.HR_ADMIN,
    edit: PERMISSIONS.HR_ADMIN,
    delete: PERMISSIONS.HR_ADMIN,
    approve: PERMISSIONS.HR_ADMIN,
  },
};

export function ceilingPermission(module: AiModuleKey, operation: AiOperation): Permission | null {
  return CEILING[module][operation];
}

/** True when the role's permissions allow this (module, operation) at all. */
export function roleAllows(permissions: ReadonlySet<Permission>, module: AiModuleKey, operation: AiOperation): boolean {
  const required = CEILING[module][operation];
  return required !== null && permissions.has(required);
}

/** The full ceiling for a role: every cell the role would allow if the company granted it. */
export function ceilingFor(permissions: ReadonlySet<Permission>): Record<AiModuleKey, AiModuleGrant> {
  const out = {} as Record<AiModuleKey, AiModuleGrant>;
  for (const mod of AI_MODULES) {
    const grant = emptyModuleGrant();
    for (const operation of AI_OPERATIONS) grant[operation] = roleAllows(permissions, mod, operation);
    out[mod] = grant;
  }
  return out;
}

/** Cells that are on in `modules` but above the ceiling: "inventory.delete", ... Empty means valid. */
export function violations(
  modules: AiModules,
  permissions: ReadonlySet<Permission>
): string[] {
  const out: string[] = [];
  for (const mod of AI_MODULES) {
    const grant = modules[mod];
    if (!grant) continue;
    for (const operation of AI_OPERATIONS) {
      if (grant[operation] && !roleAllows(permissions, mod, operation)) out.push(`${mod}.${operation}`);
    }
  }
  return out;
}

/** Drops every cell above the ceiling. Used by presets, never by saves (saves reject instead). */
export function clampToCeiling(
  modules: AiModules,
  permissions: ReadonlySet<Permission>
): AiModules {
  const out: AiModules = {};
  for (const mod of AI_MODULES) {
    const grant = modules[mod];
    if (!grant) continue;
    const clamped = emptyModuleGrant();
    for (const operation of AI_OPERATIONS) clamped[operation] = grant[operation] && roleAllows(permissions, mod, operation);
    out[mod] = clamped;
  }
  return out;
}

/** The tenant-identity words no tool input may contain. Enforced by a test over every registered tool. */
export const FORBIDDEN_TOOL_INPUT_KEYS = [
  "companyId",
  "company_id",
  "organizationId",
  "userId",
  "user_id",
  "memberId",
  "role",
  "roles",
  "permission",
  "permissions",
  "tenantId",
] as const;
