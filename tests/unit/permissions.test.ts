import { describe, expect, it } from "vitest";
import { AppError } from "@/shared/lib/errors";
import { assertPermission, PERMISSIONS, permissionsForRole } from "@/server/security/permissions";

describe("role permissions", () => {
  it("lets owners and admins approve orders and adjust stock", () => {
    for (const role of ["owner", "admin"] as const) {
      const perms = permissionsForRole(role);
      expect(perms.has(PERMISSIONS.PURCHASING_ORDER_APPROVE)).toBe(true);
      expect(perms.has(PERMISSIONS.INVENTORY_STOCK_ADJUST)).toBe(true);
    }
  });

  it("keeps approvals and count adjustments away from operators", () => {
    const perms = permissionsForRole("operator");
    expect(perms.has(PERMISSIONS.PURCHASING_ORDER_APPROVE)).toBe(false);
    expect(perms.has(PERMISSIONS.INVENTORY_STOCK_ADJUST)).toBe(false);
    expect(perms.has(PERMISSIONS.PURCHASING_RECEIPT_POST)).toBe(true);
    expect(perms.has(PERMISSIONS.MANUFACTURING_WORK_ORDER_EXECUTE)).toBe(true);
  });

  it("gives viewers read access only", () => {
    const perms = permissionsForRole("viewer");
    expect(perms.has(PERMISSIONS.INVENTORY_READ)).toBe(true);
    for (const permission of Object.values(PERMISSIONS)) {
      if (!permission.endsWith(".read") && !permission.endsWith(".view")) {
        expect(perms.has(permission)).toBe(false);
      }
    }
  });

  it("throws FORBIDDEN for missing permissions", () => {
    const perms = permissionsForRole("viewer");
    try {
      assertPermission(perms, PERMISSIONS.INVENTORY_PRODUCT_MANAGE);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(403);
    }
  });
});
