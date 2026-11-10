import type { Metadata } from "next";
import { getCurrentAuthUser } from "@/server/auth/rbac";
import { getPageWorkspace } from "@/server/tenancy/workspace";
import {
  getEmployees,
  getDepartments,
  getJobTitles,
  getHRDashboardStats,
  getLeaveRequests,
  getLeaveBalance,
  getTodayAttendance,
  getAttendanceHistory,
  getPayslips,
  getPayrollSummary,
} from "@/server/services/hr.service";
import { HRDashboardClient } from "@/features/hr/components/hr-dashboard-client";

export const metadata: Metadata = {
  title: "HR & Payroll | AnOps ERP",
  description:
    "Comprehensive HR management: Employees, Time-off Approvals, Attendance Punch, Payroll Generator & AI Policy Assistant.",
};

export default async function HRPage() {
  const currentPeriod = "2026-10";

  // Resolves the active company or redirects to login / onboarding. Every HR query below uses this company.
  const workspace = await getPageWorkspace();
  const activeCompanyId = workspace.companyId.toHexString();

  const authUser = await getCurrentAuthUser();
  const userRole = authUser?.isAdmin ? "hr_admin" : (authUser?.role ?? "employee");

  // Always load departments and job titles for the form modals (scoped to active company)
  const [employees, departments, jobTitles, stats] = await Promise.all([
    getEmployees({}, activeCompanyId),
    getDepartments(activeCompanyId),
    getJobTitles(activeCompanyId),
    getHRDashboardStats(activeCompanyId),
  ]);

  // Find the current employee record for the logged-in user in this active company
  const currentEmployee = authUser?.employee || employees[0] || null;

  // Backend restriction: non-admin employees only get their own data
  const employeeIdFilter = userRole === "hr_admin" ? undefined : currentEmployee?.id;

  const [leaveRequests, todayAttendance, attendanceHistory, payslips, payrollSummary] = await Promise.all([
    getLeaveRequests(employeeIdFilter ? { employeeId: employeeIdFilter } : {}, activeCompanyId),
    getTodayAttendance(activeCompanyId),
    getAttendanceHistory(employeeIdFilter ? { employeeId: employeeIdFilter } : {}, activeCompanyId),
    getPayslips({ period: currentPeriod, ...(employeeIdFilter ? { employeeId: employeeIdFilter } : {}) }, activeCompanyId),
    userRole === "hr_admin"
      ? getPayrollSummary(currentPeriod, activeCompanyId)
      : Promise.resolve({
          period: currentPeriod,
          totalGross: 0,
          totalDeductions: 0,
          totalNet: 0,
          totalEmployees: 1,
          payslipsGenerated: 0,
        }),
  ]);

  const leaveBalance = currentEmployee
    ? await getLeaveBalance(currentEmployee.id, 2026, activeCompanyId)
    : {
        employeeId: "",
        employeeName: "",
        year: 2026,
        allowance: 25,
        usedPaidDays: 0,
        remainingDays: 25,
        unpaidDaysTaken: 0,
      };

  return (
    <HRDashboardClient
      initialEmployees={employees}
      initialDepartments={departments}
      initialJobTitles={jobTitles}
      initialStats={stats}
      initialLeaveRequests={leaveRequests}
      initialLeaveBalance={leaveBalance}
      initialTodayAttendance={todayAttendance}
      initialAttendanceHistory={attendanceHistory}
      initialPayslips={payslips}
      initialPayrollSummary={payrollSummary}
      currentEmployee={currentEmployee}
      userRole={userRole}
    />
  );
}
