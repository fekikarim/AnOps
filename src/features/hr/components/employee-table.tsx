"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useState, useTransition } from "react";
import {
  Search,
  Building2,
  Edit3,
  UserCheck,
  UserX,
  Phone,
  Mail,
  Calendar,
  Briefcase,
  DollarSign,
  Plus,
  Tag,
} from "lucide-react";
import type { Employee, Department, JobTitle } from "@/features/hr/types";
import { toggleEmployeeStatusAction } from "@/features/hr/actions/employee.action";
import { DepartureReviewModal } from "./departure-review-modal";
import { cn } from "@/shared/lib/utils";

type EmployeeTableProps = {
  employees: Employee[];
  departments: Department[];
  jobTitles: JobTitle[];
  onEditEmployee: (employee: Employee) => void;
  onAddNewEmployee: () => void;
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function EmployeeTable({
  employees,
  departments,
  jobTitles,
  onEditEmployee,
  onAddNewEmployee,
}: EmployeeTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | "active" | "inactive">("all");
  const [isPending, startTransition] = useTransition();

  // Filter in-memory for instant feedback
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.jobTitle.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDept = selectedDept === "all" || emp.departmentId === selectedDept;
    const matchesStatus = selectedStatus === "all" || emp.status === selectedStatus;

    return matchesSearch && matchesDept && matchesStatus;
  });

  const [departureEmployee, setDepartureEmployee] = useState<Employee | null>(null);

  const handleToggleStatus = async (id: string, name: string, currentStatus: "active" | "inactive") => {
    const deactivating = currentStatus === "active";
    const confirmed = await confirmAction({
      title: deactivating ? `Deactivate ${name}?` : `Activate ${name}?`,
      message: deactivating ? "They can no longer request leave or receive monthly payroll." : "They can request leave and receive monthly payroll again.",
      tone: deactivating ? "warning" : "default",
      confirmLabel: deactivating ? "Deactivate" : "Activate",
    });
    if (!confirmed) return;

    const empObj = employees.find((e) => e.id === id);

    startTransition(async () => {
      await toggleEmployeeStatusAction(id);
      if (currentStatus === "active" && empObj) {
        setDepartureEmployee(empObj);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Search & Filters Bar */}
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, email, or job title..."
            className="w-full min-h-[42px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] pl-10 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          />
          <Search className="absolute left-3 top-3 h-4 w-4 text-[var(--color-text-secondary)]" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Department Filter */}
          <select
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            className="min-h-[42px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-semibold text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
          >
            <option value="all">All Departments ({departments.length})</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          {/* Status Segmented Buttons */}
          <div className="flex rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-1">
            {(["all", "active", "inactive"] as const).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setSelectedStatus(status)}
                className={cn(
                  "min-h-[34px] rounded-[calc(var(--radius-control)-2px)] px-3 text-xs font-semibold capitalize transition-colors",
                  selectedStatus === status
                    ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shadow-xs"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Employees Table (Desktop) & Cards (Mobile) */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden shadow-xs">
        {/* Desktop Table View */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
              <tr>
                <th className="py-3.5 pl-6 pr-4">Employee</th>
                <th className="px-4 py-3.5">Department</th>
                <th className="px-4 py-3.5">Job Title</th>
                <th className="px-4 py-3.5">Base Salary</th>
                <th className="px-4 py-3.5">Hire Date</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="py-3.5 pl-4 pr-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {filteredEmployees.map((emp) => {
                const titleMeta = jobTitles.find(
                  (t) => t.title.toLowerCase() === emp.jobTitle.toLowerCase()
                );
                const isCustom = titleMeta ? !titleMeta.isPredefined : false;

                return (
                  <tr
                    key={emp.id}
                    className="hover:bg-[var(--color-bg-subtle)]/50 transition-colors"
                  >
                    {/* Employee Profile */}
                    <td className="py-4 pl-6 pr-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-xs font-bold text-[var(--color-action-on-primary)] ring-2 ring-[var(--color-border-subtle)]">
                          {getInitials(emp.fullName)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--color-text-primary)] truncate">
                            {emp.fullName}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                            <span className="truncate">{emp.email}</span>
                            {emp.phone && (
                              <span className="text-[10px] text-[var(--color-text-secondary)]">
                                · {emp.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Department */}
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-primary)]">
                        <Building2 className="h-3 w-3 text-[var(--color-text-secondary)]" />
                        {emp.departmentName}
                      </span>
                    </td>

                    {/* Job Title */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-[var(--color-text-primary)]">
                          {emp.jobTitle}
                        </span>
                        {isCustom && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-[#fbf2da] px-1.5 py-0.5 text-[10px] font-semibold text-[#7b5915]">
                            <Tag className="h-2.5 w-2.5" /> Custom
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Base Salary */}
                    <td className="px-4 py-4">
                      <span className="font-semibold numeric text-[var(--color-text-primary)]">
                        {emp.baseSalary.toLocaleString()} TND
                      </span>
                      <span className="block text-[11px] text-[var(--color-text-secondary)]">
                        monthly
                      </span>
                    </td>

                    {/* Hire Date */}
                    <td className="px-4 py-4 text-xs text-[var(--color-text-secondary)]">
                      {emp.hireDate}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-4">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(emp.id, emp.fullName, emp.status)}
                        disabled={isPending}
                        title={`Click to ${emp.status === "active" ? "deactivate" : "activate"}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2.5 py-1 text-xs font-bold transition-all",
                          emp.status === "active"
                            ? "bg-[#e9f2ea] text-[#176247] hover:bg-[#d5e7d7]"
                            : "bg-[#fff1ee] text-[#a43434] hover:bg-[#fcded9]"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            emp.status === "active" ? "bg-[#176247]" : "bg-[#a43434]"
                          )}
                        />
                        {emp.status === "active" ? "Active" : "Inactive"}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-4 pl-4 pr-6 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onEditEmployee(emp)}
                          className="flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 text-xs font-semibold text-[var(--color-text-primary)] hover:border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)]"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStatus(emp.id, emp.fullName, emp.status)}
                          className={cn(
                            "flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-xs",
                            emp.status === "active"
                              ? "text-[var(--color-status-error)] hover:bg-[var(--color-status-error-bg)]"
                              : "text-[#176247] hover:bg-[#e9f2ea]"
                          )}
                          title={emp.status === "active" ? "Deactivate employee" : "Activate employee"}
                        >
                          {emp.status === "active" ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="divide-y divide-[var(--color-border-subtle)] lg:hidden">
          {filteredEmployees.map((emp) => (
            <div key={emp.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-xs font-bold text-[var(--color-action-on-primary)]">
                    {getInitials(emp.fullName)}
                  </div>
                  <div>
                    <p className="font-bold text-[var(--color-text-primary)]">{emp.fullName}</p>
                    <p className="text-xs text-[var(--color-text-secondary)]">{emp.email}</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-bold",
                    emp.status === "active"
                      ? "bg-[#e9f2ea] text-[#176247]"
                      : "bg-[#fff1ee] text-[#a43434]"
                  )}
                >
                  {emp.status === "active" ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-canvas)] p-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                    Job Title
                  </span>
                  <p className="font-semibold text-[var(--color-text-primary)] mt-0.5">
                    {emp.jobTitle}
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-canvas)] p-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                    Department
                  </span>
                  <p className="font-semibold text-[var(--color-text-primary)] mt-0.5">
                    {emp.departmentName}
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-canvas)] p-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                    Monthly Salary
                  </span>
                  <p className="font-bold text-[var(--color-text-primary)] mt-0.5">
                    {emp.baseSalary.toLocaleString()} TND
                  </p>
                </div>
                <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-canvas)] p-2">
                  <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                    Hire Date
                  </span>
                  <p className="font-semibold text-[var(--color-text-primary)] mt-0.5">
                    {emp.hireDate}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onEditEmployee(emp)}
                  className="flex min-h-[38px] items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-3 text-xs font-semibold text-[var(--color-text-primary)]"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleStatus(emp.id, emp.fullName, emp.status)}
                  className="min-h-[38px] rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] px-3 text-xs font-semibold text-[var(--color-text-primary)]"
                >
                  {emp.status === "active" ? "Deactivate" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {filteredEmployees.length === 0 && (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]">
              <Briefcase className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-base font-bold text-[var(--color-text-primary)]">
              No employees found
            </h3>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)] max-w-sm">
              {searchTerm || selectedDept !== "all" || selectedStatus !== "all"
                ? "Try adjusting your search criteria or filters to locate staff members."
                : "Get started by adding your first employee to the AnOps HR directory."}
            </p>
            <button
              type="button"
              onClick={onAddNewEmployee}
              className="mt-4 flex min-h-[44px] items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
            >
              <Plus className="h-4 w-4" />
              Add Employee
            </button>
          </div>
        )}
      </div>

      {departureEmployee && (
        <DepartureReviewModal
          isOpen={Boolean(departureEmployee)}
          onClose={() => setDepartureEmployee(null)}
          employee={departureEmployee}
        />
      )}
    </div>
  );
}
