"use client";

import { useState } from "react";
import {
  Users,
  Calendar,
  Clock,
  DollarSign,
  Sparkles,
  Briefcase,
  Building2,
  Plus,
  RefreshCw,
  MessageSquare,
} from "lucide-react";
import type {
  Employee,
  Department,
  JobTitle,
  HRDashboardStats,
  LeaveRequest,
  LeaveBalance,
  TodayAttendanceSummary,
  AttendanceRecord,
  PayslipRecord,
  PayrollSummary,
} from "@/features/hr/types";
import { HRStatsCards } from "./hr-stats-cards";
import { EmployeeTable } from "./employee-table";
import { EmployeeModal } from "./employee-modal";
import { JobTitlesModal } from "./job-titles-modal";
import { DepartmentModal } from "./department-modal";
import { LeaveSection } from "./leave-section";
import { AttendanceSection } from "./attendance-section";
import { PayrollSection } from "./payroll-section";
import { AIHRAssistant } from "./ai-hr-assistant";
import { useAiFeatures } from "@/features/platform/components/ai-features";
import { useRouter } from "next/navigation";

export type HRTab = "employees" | "leave" | "attendance" | "payroll" | "ai";

type HRDashboardClientProps = {
  initialEmployees: Employee[];
  initialDepartments: Department[];
  initialJobTitles: JobTitle[];
  initialStats: HRDashboardStats;
  initialLeaveRequests: LeaveRequest[];
  initialLeaveBalance: LeaveBalance;
  initialTodayAttendance: TodayAttendanceSummary;
  initialAttendanceHistory: AttendanceRecord[];
  initialPayslips: PayslipRecord[];
  initialPayrollSummary: PayrollSummary;
  currentEmployee?: Employee | null;
  userRole?: "employee" | "manager" | "hr_admin";
};

export function HRDashboardClient({
  initialEmployees,
  initialDepartments,
  initialJobTitles,
  initialStats,
  initialLeaveRequests,
  initialLeaveBalance,
  initialTodayAttendance,
  initialAttendanceHistory,
  initialPayslips,
  initialPayrollSummary,
  currentEmployee,
  userRole = "employee",
}: HRDashboardClientProps) {
  const router = useRouter();
  const aiFeatures = useAiFeatures();
  const isAdmin = userRole === "hr_admin";

  // Active module tab
  const [activeTab, setActiveTab] = useState<HRTab>(isAdmin ? "employees" : "leave");

  // Modals for Employee Management
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [jobTitlesModalOpen, setJobTitlesModalOpen] = useState(false);
  const [departmentModalOpen, setDepartmentModalOpen] = useState(false);
  const [leaveRequestModalOpen, setLeaveRequestModalOpen] = useState(false);

  const handleOpenAddEmployee = () => {
    setEditingEmployee(null);
    setEmployeeModalOpen(true);
  };

  const handleEditEmployee = (emp: Employee) => {
    setEditingEmployee(emp);
    setEmployeeModalOpen(true);
  };

  const handleRefresh = () => {
    router.refresh();
  };

  // Pending leave requests count for badge
  const pendingLeaveCount = initialLeaveRequests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6 reveal">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--color-text-primary)]">
              HR & Payroll
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-action-primary)]/20 px-2.5 py-0.5 text-xs font-bold text-[var(--color-text-primary)]">
              <Sparkles className="h-3 w-3" /> Core Module
            </span>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-[var(--color-text-secondary)]">
            Employee Directory, Time-off Approvals, Live Attendance, Payroll Generator & AI Policy Assistant
          </p>
        </div>

        {/* Global Action Buttons — admin only */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Job Titles */}
          {isAdmin && (
          <button
            type="button"
            onClick={() => setJobTitlesModalOpen(true)}
            className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-primary)] hover:border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)] transition-all shadow-xs"
          >
            <Briefcase className="h-4 w-4 text-[var(--color-text-secondary)]" />
            <span>Job Titles</span>
            <span className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
              {initialJobTitles.length}
            </span>
          </button>
          )}

          {/* Departments */}
          {isAdmin && (
          <button
            type="button"
            onClick={() => setDepartmentModalOpen(true)}
            className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-primary)] hover:border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)] transition-all shadow-xs"
          >
            <Building2 className="h-4 w-4 text-[var(--color-text-secondary)]" />
            <span>Departments</span>
            <span className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
              {initialDepartments.length}
            </span>
          </button>
          )}

          {/* Add Employee CTA — admin only */}
          {isAdmin && (
          <button
            type="button"
            onClick={handleOpenAddEmployee}
            className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors shadow-xs"
          >
            <Plus className="h-4 w-4" />
            <span>Add Employee</span>
          </button>
          )}
        </div>
      </div>

      {/* Modern Navigation Tabs for the 5 Deliverables */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border-subtle)] pb-2 no-scrollbar">
        {/* Tab 1: Employees — admin only */}
        {isAdmin && (
        <button
          type="button"
          onClick={() => setActiveTab("employees")}
          className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold transition-all ${
            activeTab === "employees"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Employees ({initialEmployees.length})</span>
        </button>
        )}

        {/* Tab 2: Time-off & Leave */}
        <button
          type="button"
          onClick={() => setActiveTab("leave")}
          className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold transition-all ${
            activeTab === "leave"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Calendar className="h-4 w-4" />
          <span>Time-Off & Leave</span>
          {pendingLeaveCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                activeTab === "leave"
                  ? "bg-[var(--color-action-on-primary)] text-[var(--color-action-primary)]"
                  : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
              }`}
            >
              {pendingLeaveCount}
            </span>
          )}
        </button>

        {/* Tab 3: Attendance */}
        <button
          type="button"
          onClick={() => setActiveTab("attendance")}
          className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold transition-all ${
            activeTab === "attendance"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Attendance</span>
          <span className="flex h-2 w-2 rounded-full bg-[var(--color-status-success)]" />
        </button>

        {/* Tab 4: Payroll Generator */}
        <button
          type="button"
          onClick={() => setActiveTab("payroll")}
          className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold transition-all ${
            activeTab === "payroll"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <DollarSign className="h-4 w-4" />
          <span>Payroll Generator</span>
        </button>

        {aiFeatures && (
          <>
        {/* Tab 5: AI HR Assistant */}
        <button
          type="button"
          onClick={() => setActiveTab("ai")}
          className={`flex min-h-[42px] shrink-0 items-center gap-2 rounded-[var(--radius-control)] px-4 text-xs font-bold transition-all ${
            activeTab === "ai"
              ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
          }`}
        >
          <Sparkles className="h-4 w-4" />
          <span>AI HR Assistant</span>
          <span className="rounded-full bg-[var(--color-bg-subtle)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-extrabold text-[var(--color-text-secondary)]">
            AI
          </span>
        </button>
          </>
        )}
      </div>

      {/* Tab Content Display */}
      {activeTab === "employees" && (
        <div className="space-y-6">
          {/* KPI Stats */}
          <HRStatsCards stats={initialStats} />

          {/* Directory Section */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                  Employee Directory
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  Full roster of active and inactive team members across departments
                </p>
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                title="Refresh employee data"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            {/* Directory Table */}
            <EmployeeTable
              employees={initialEmployees}
              departments={initialDepartments}
              jobTitles={initialJobTitles}
              onEditEmployee={handleEditEmployee}
              onAddNewEmployee={handleOpenAddEmployee}
            />
          </section>
        </div>
      )}

      {activeTab === "leave" && (
        <LeaveSection
          leaveRequests={initialLeaveRequests}
          employees={isAdmin ? initialEmployees : initialEmployees.filter(e => e.id === currentEmployee?.id)}
          currentEmployee={currentEmployee}
          leaveBalance={initialLeaveBalance}
          onRefresh={handleRefresh}
          userRole={userRole}
          requestModalOpen={leaveRequestModalOpen}
          onRequestModalOpenChange={setLeaveRequestModalOpen}
        />
      )}

      {activeTab === "attendance" && (
        <AttendanceSection
          todaySummary={initialTodayAttendance}
          attendanceHistory={initialAttendanceHistory}
          employees={isAdmin ? initialEmployees : initialEmployees.filter(e => e.id === currentEmployee?.id)}
          currentEmployee={currentEmployee}
          onRefresh={handleRefresh}
          userRole={userRole}
        />
      )}

      {activeTab === "payroll" && (
        <PayrollSection
          initialPayslips={isAdmin ? initialPayslips : initialPayslips.filter(p => p.employeeId === currentEmployee?.id)}
          initialSummary={initialPayrollSummary}
          employees={isAdmin ? initialEmployees : initialEmployees.filter(e => e.id === currentEmployee?.id)}
          currentEmployee={currentEmployee}
          onRefresh={handleRefresh}
          userRole={userRole}
        />
      )}

      {aiFeatures && activeTab === "ai" && (
        <AIHRAssistant
          userRole={userRole}
          onDataChanged={handleRefresh}
          onNavigateTab={setActiveTab}
          onOpenLeaveRequest={() => {
            setActiveTab("leave");
            setLeaveRequestModalOpen(true);
          }}
        />
      )}

      {/* Modals for Employee Management */}
      <EmployeeModal
        isOpen={employeeModalOpen}
        onClose={() => setEmployeeModalOpen(false)}
        departments={initialDepartments}
        jobTitles={initialJobTitles}
        employeeToEdit={editingEmployee}
        onSuccess={handleRefresh}
      />

      <JobTitlesModal
        isOpen={jobTitlesModalOpen}
        onClose={() => setJobTitlesModalOpen(false)}
        jobTitles={initialJobTitles}
        departments={initialDepartments}
        onRefresh={handleRefresh}
      />

      <DepartmentModal
        isOpen={departmentModalOpen}
        onClose={() => setDepartmentModalOpen(false)}
        departments={initialDepartments}
        onRefresh={handleRefresh}
      />
    </div>
  );
}
