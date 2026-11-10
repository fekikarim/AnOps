import { describe, expect, it } from "vitest";
import { PERMISSIONS, permissionsForRole, roleMayOpenApp, workspaceRoleFor } from "@/server/security/permissions";

describe("role matrix", () => {
  const viewer = permissionsForRole(workspaceRoleFor("employee"));
  const operator = permissionsForRole(workspaceRoleFor("manager"));
  const admin = permissionsForRole(workspaceRoleFor("admin"));

  it("employees cannot read finance, supplier or marketing data", () => {
    for (const p of [PERMISSIONS.FINANCE_READ, PERMISSIONS.FINANCE_REPORT_VIEW, PERMISSIONS.PURCHASING_READ, PERMISSIONS.MARKETING_READ]) expect(viewer.has(p)).toBe(false);
    expect(roleMayOpenApp(viewer, "finance")).toBe(false);
    expect(roleMayOpenApp(viewer, "purchasing")).toBe(false);
    expect(roleMayOpenApp(viewer, "marketing")).toBe(false);
  });

  it("employees keep team-level reads", () => {
    for (const p of [PERMISSIONS.HR_READ, PERMISSIONS.INVENTORY_READ, PERMISSIONS.MANUFACTURING_READ, PERMISSIONS.COMMUNITY_READ]) expect(viewer.has(p)).toBe(true);
    expect(roleMayOpenApp(viewer, "inventory")).toBe(true);
    expect(roleMayOpenApp(viewer, "hr-payroll")).toBe(true);
  });

  it("managers and admins keep the business reads they need to run those processes", () => {
    for (const role of [operator, admin]) {
      expect(roleMayOpenApp(role, "finance")).toBe(true);
      expect(roleMayOpenApp(role, "purchasing")).toBe(true);
      expect(roleMayOpenApp(role, "marketing")).toBe(true);
    }
    expect(operator.has(PERMISSIONS.FINANCE_REPORT_VIEW)).toBe(true);
  });
});
