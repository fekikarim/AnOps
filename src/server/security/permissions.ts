import "server-only";
import type { CompanyRole } from "@/features/company/types";
import { AppError } from "@/shared/lib/errors";
import type { ApplicationId } from "@/shared/domain/applications";

/**
 * Central permission catalogue for every company-scoped module (HR, inventory, purchasing,
 * manufacturing). Permissions are granted through the user's role in the active company.
 * Every service asserts the permission it needs, so a hidden button is never the only control.
 */
export const PERMISSIONS = {
  HR_READ: "hr.read",
  HR_MANAGE: "hr.manage",
  /** HR changes and approvals made through the AI Command Center: owners and admins only, matching the HR server actions. */
  HR_ADMIN: "hr.admin",
  HR_ATTENDANCE_RECORD: "hr.attendance.record",
  INVENTORY_READ: "inventory.read",
  INVENTORY_PRODUCT_MANAGE: "inventory.product.manage",
  INVENTORY_WAREHOUSE_MANAGE: "inventory.warehouse.manage",
  INVENTORY_STOCK_MOVE: "inventory.stock.move",
  INVENTORY_STOCK_ADJUST: "inventory.stock.adjust",
  PURCHASING_READ: "purchasing.read",
  PURCHASING_SUPPLIER_MANAGE: "purchasing.supplier.manage",
  PURCHASING_ORDER_MANAGE: "purchasing.order.manage",
  PURCHASING_ORDER_APPROVE: "purchasing.order.approve",
  PURCHASING_RECEIPT_POST: "purchasing.receipt.post",
  MANUFACTURING_READ: "manufacturing.read",
  MANUFACTURING_BOM_MANAGE: "manufacturing.bom.manage",
  MANUFACTURING_WORK_ORDER_MANAGE: "manufacturing.work_order.manage",
  MANUFACTURING_WORK_ORDER_EXECUTE: "manufacturing.work_order.execute",
  FINANCE_READ: "finance.read",
  FINANCE_CUSTOMER_MANAGE: "finance.customer.manage",
  FINANCE_INVOICE_MANAGE: "finance.invoice.manage",
  FINANCE_INVOICE_POST: "finance.invoice.post",
  FINANCE_PAYMENT_ALLOCATE: "finance.payment.allocate",
  FINANCE_EXPENSE_MANAGE: "finance.expense.manage",
  FINANCE_EXPENSE_APPROVE: "finance.expense.approve",
  FINANCE_EXPENSE_PAY: "finance.expense.pay",
  FINANCE_RECEIPT_OCR: "finance.receipt.ocr",
  FINANCE_REPORT_VIEW: "finance.report.view",
  MARKETING_READ: "marketing.read",
  MARKETING_CONTACT_MANAGE: "marketing.contact.manage",
  MARKETING_TAG_MANAGE: "marketing.tag.manage",
  MARKETING_AUDIENCE_MANAGE: "marketing.audience.manage",
  MARKETING_TEMPLATE_MANAGE: "marketing.template.manage",
  MARKETING_CONSENT_MANAGE: "marketing.consent.manage",
  MARKETING_CAMPAIGN_MANAGE: "marketing.campaign.manage",
  MARKETING_CAMPAIGN_APPROVE: "marketing.campaign.approve",
  MARKETING_CAMPAIGN_DISPATCH: "marketing.campaign.dispatch",
  MARKETING_SOCIAL_MANAGE: "marketing.social.manage",
  MARKETING_SOCIAL_PUBLISH: "marketing.social.publish",
  MARKETING_AI_GENERATE: "marketing.ai.generate",
  /** Approvals and sends made through the AI Command Center: owners and admins only. The ceiling for AI approve and delete cells. */
  MARKETING_ADMIN: "marketing.admin",
  COMMUNITY_READ: "community.read",
  /** Draft articles, start forum topics, reply and comment. Operators and above. */
  COMMUNITY_WRITE: "community.write",
  /** Answer live-chat conversations as an agent and close them. Operators and above. */
  COMMUNITY_SUPPORT: "community.support",
  /** Publish, archive, pin and delete community content, and seed demo data. Owners and admins only. The ceiling for AI approve and delete cells. */
  COMMUNITY_ADMIN: "community.admin",
  /** Owner/admin only. Using AI needs no role permission: the company grant plus each cell's own module permission is the gate. */
  AI_ACCESS_MANAGE: "ai.access.manage",
  AI_USAGE_VIEW: "ai.usage.view",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Workspace roles used by the permission catalogue. Mapped from the company role; see docs/ROLES_AND_PERMISSIONS.md. */
export type WorkspaceRole = "owner" | "admin" | "operator" | "viewer";

/** company owner/admin keep their rank; company manager operates; company employee is read-only. */
export function workspaceRoleFor(companyRole: CompanyRole): WorkspaceRole {
  switch (companyRole) {
    case "owner":
      return "owner";
    case "admin":
      return "admin";
    case "manager":
      return "operator";
    case "employee":
      return "viewer";
  }
}

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/**
 * What every member may read. HR is further restricted by its own rules (people see their own leave and pay data).
 * Stock and production figures are operational and shared with the whole team.
 */
const TEAM_READ_PERMISSIONS: Permission[] = [PERMISSIONS.HR_READ, PERMISSIONS.INVENTORY_READ, PERMISSIONS.MANUFACTURING_READ, PERMISSIONS.COMMUNITY_READ];

/**
 * Money, supplier terms and personal data of customers and contacts. Not granted to the "employee" role by default:
 * a regular team member has no business reading company finances, payments, supplier prices or the marketing contact list.
 * Managers (operators) and above keep them because they run those processes.
 */
const BUSINESS_READ_PERMISSIONS: Permission[] = [PERMISSIONS.PURCHASING_READ, PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_REPORT_VIEW, PERMISSIONS.MARKETING_READ];

/** Applications that need a role-level read permission before they can be opened (plan access is checked separately). */
const APP_READ_PERMISSION: Partial<Record<ApplicationId, Permission>> = {
  finance: PERMISSIONS.FINANCE_READ,
  purchasing: PERMISSIONS.PURCHASING_READ,
  marketing: PERMISSIONS.MARKETING_READ,
};

export function roleMayOpenApp(permissions: ReadonlySet<Permission>, appId: ApplicationId): boolean {
  const needed = APP_READ_PERMISSION[appId];
  return !needed || permissions.has(needed);
}

/**
 * owner/admin: full control, including approvals, manual stock adjustments and HR administration.
 * operator (company manager): day-to-day execution: staff, job titles, attendance, stock moves,
 *   receipts, production. Cannot approve purchase orders or adjust stock counts.
 *   Marketing: operators draft, manage contacts and social accounts, and generate AI copy.
 *   Approving and dispatching campaigns (which contact real people) is owner/admin only.
 * viewer (company employee): read-only access to team data (HR own records, stock, production, community); no finance,
 *   supplier or marketing-contact data.
 */
const ROLE_PERMISSIONS: Record<WorkspaceRole, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  operator: [
    ...TEAM_READ_PERMISSIONS,
    ...BUSINESS_READ_PERMISSIONS,
    PERMISSIONS.HR_MANAGE,
    PERMISSIONS.HR_ATTENDANCE_RECORD,
    PERMISSIONS.INVENTORY_PRODUCT_MANAGE,
    PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE,
    PERMISSIONS.INVENTORY_STOCK_MOVE,
    PERMISSIONS.PURCHASING_SUPPLIER_MANAGE,
    PERMISSIONS.PURCHASING_ORDER_MANAGE,
    PERMISSIONS.PURCHASING_RECEIPT_POST,
    PERMISSIONS.MANUFACTURING_BOM_MANAGE,
    PERMISSIONS.MANUFACTURING_WORK_ORDER_MANAGE,
    PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE,
    PERMISSIONS.FINANCE_CUSTOMER_MANAGE,
    PERMISSIONS.FINANCE_INVOICE_MANAGE,
    PERMISSIONS.FINANCE_EXPENSE_MANAGE,
    PERMISSIONS.FINANCE_RECEIPT_OCR,
    PERMISSIONS.MARKETING_CONTACT_MANAGE,
    PERMISSIONS.MARKETING_TAG_MANAGE,
    PERMISSIONS.MARKETING_AUDIENCE_MANAGE,
    PERMISSIONS.MARKETING_TEMPLATE_MANAGE,
    PERMISSIONS.MARKETING_CONSENT_MANAGE,
    PERMISSIONS.MARKETING_CAMPAIGN_MANAGE,
    PERMISSIONS.MARKETING_SOCIAL_MANAGE,
    PERMISSIONS.MARKETING_SOCIAL_PUBLISH,
    PERMISSIONS.MARKETING_AI_GENERATE,
    PERMISSIONS.COMMUNITY_WRITE,
    PERMISSIONS.COMMUNITY_SUPPORT,
  ],
  viewer: [...TEAM_READ_PERMISSIONS],
};

export function permissionsForRole(role: WorkspaceRole): ReadonlySet<Permission> {
  return new Set(ROLE_PERMISSIONS[role]);
}

export function assertPermission(permissions: ReadonlySet<Permission>, permission: Permission): void {
  if (!permissions.has(permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
}
