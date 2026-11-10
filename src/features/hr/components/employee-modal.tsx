"use client";

import { useState, useTransition } from "react";
import { X, Loader2, User, Mail, Phone, Calendar, DollarSign, Shield, Copy, Check, KeyRound } from "lucide-react";
import type { Department, JobTitle, Employee } from "@/features/hr/types";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";
import { Portal } from "@/shared/components/ui/portal";
import { JobTitleCombobox } from "./job-title-combobox";
import { createEmployeeAction, updateEmployeeAction } from "@/features/hr/actions/employee.action";

type EmployeeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  departments: Department[];
  jobTitles: JobTitle[];
  employeeToEdit?: Employee | null;
  onSuccess?: () => void;
};

export function EmployeeModal({
  isOpen,
  onClose,
  departments,
  jobTitles,
  employeeToEdit,
  onSuccess,
}: EmployeeModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form fields
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [isCustomJobTitle, setIsCustomJobTitle] = useState(false);
  const [hireDate, setHireDate] = useState("");
  const [baseSalary, setBaseSalary] = useState<number | "">(3500);
  const [role, setRole] = useState<"employee" | "manager" | "hr_admin">("employee");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  const isEditing = Boolean(employeeToEdit);

  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  // The form is re-seeded whenever the modal opens or the employee being edited changes (state adjusted during render).
  const formKey = isOpen ? (employeeToEdit?.id ?? "new") : null;
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (seededFor !== formKey) {
    setSeededFor(formKey);
    if (employeeToEdit) {
      setFullName(employeeToEdit.fullName);
      setEmail(employeeToEdit.email);
      setPhone(employeeToEdit.phone || "");
      setDepartmentId(employeeToEdit.departmentId);
      setJobTitle(employeeToEdit.jobTitle);
      setHireDate(employeeToEdit.hireDate);
      setBaseSalary(employeeToEdit.baseSalary);
      setRole(employeeToEdit.role);
      setStatus(employeeToEdit.status);
    } else {
      setFullName("");
      setEmail("");
      setPhone("");
      setDepartmentId(departments[0]?.id || "");
      setJobTitle(jobTitles[0]?.title || "");
      setIsCustomJobTitle(false);
      setHireDate(new Date().toISOString().split("T")[0]);
      setBaseSalary(3200);
      setRole("employee");
      setStatus("active");
    }
    setError(null);
  }

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Please enter the employee's full name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter a valid work email.");
      return;
    }
    if (!departmentId) {
      setError("Please select a department.");
      return;
    }
    if (!jobTitle.trim()) {
      setError("Please select or enter a job title.");
      return;
    }
    if (baseSalary === "" || Number(baseSalary) < 0) {
      setError("Please enter a valid base salary (0 or greater).");
      return;
    }

    const payload = {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim() || undefined,
      departmentId,
      jobTitle: jobTitle.trim(),
      isCustomJobTitle,
      hireDate,
      baseSalary: Number(baseSalary),
      role,
      status,
      leaveAllowance: 25,
    };

    startTransition(async () => {
      const result = isEditing && employeeToEdit
        ? await updateEmployeeAction(employeeToEdit.id, payload)
        : await createEmployeeAction(payload);

      if (result.error) {
        setError(result.error);
      } else if (!isEditing && result.tempPassword) {
        // Show the one-time temp password to HR admin before closing
        setTempPassword(result.tempPassword);
        onSuccess?.();
      } else {
        onSuccess?.();
        onClose();
      }
    });
  };

  const handleCopyPassword = async () => {
    if (!tempPassword) return;
    await navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismissTempPassword = () => {
    setTempPassword(null);
    setCopied(false);
    onClose();
  };

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Employee" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile Sheet Drag Indicator */}
          <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mb-2.5 sm:hidden shrink-0" />

          {/* Temp Password Success Screen */}
          {tempPassword ? (
            <div className="flex flex-col items-center gap-5 py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-action-primary)]/15">
                <KeyRound className="h-8 w-8 text-[var(--color-action-primary)]" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Employee Created!</h2>
                <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                  A login account has been provisioned. Share this one-time password securely — it won&apos;t be shown again.
                </p>
              </div>

              {/* Temp Password Display */}
              <div className="w-full rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-subtle)] p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">Temporary Password</p>
                <div className="flex items-center gap-3">
                  <code className="flex-1 rounded-[var(--radius-control)] bg-[var(--color-bg-canvas)] px-3 py-2.5 text-center font-mono text-lg font-bold tracking-widest text-[var(--color-text-primary)] select-all border border-[var(--color-border-subtle)]">
                    {tempPassword}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyPassword}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors shrink-0"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-[var(--color-text-secondary)]">
                  The employee must set a new password on first login.
                </p>
              </div>

              <div className="flex flex-col gap-2 w-full">
                <button
                  type="button"
                  onClick={handleCopyPassword}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] transition-colors"
                >
                  {copied ? <Check className="h-4 w-4 text-[var(--color-status-success)]" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied!" : "Copy password"}
                </button>
                <button
                  type="button"
                  onClick={handleDismissTempPassword}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-sm font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
          <>



          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-3 sm:pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--color-text-primary)]">
                {isEditing ? "Edit Employee Profile" : "Add New Employee"}
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                {isEditing
                  ? "Update staff contact details, department, title, or compensation"
                  : "Create a new employee profile and define role and job title"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="mt-3 sm:mt-4 rounded-[var(--radius-control)] border border-[var(--color-status-error)]/30 bg-[var(--color-status-error-bg)] p-3 text-xs text-[var(--color-status-error)] font-medium">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-4 sm:mt-5 space-y-3.5 sm:space-y-4">
            <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2">
              {/* Full Name */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Full Name <span className="text-[var(--color-status-error)]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Leila Ammar"
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-10 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <User className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Work Email <span className="text-[var(--color-status-error)]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. leila.ammar@anops.internal"
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-10 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <Mail className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Phone Number
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +216 20 555 777"
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-10 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <Phone className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>

              {/* Department */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Department <span className="text-[var(--color-status-error)]">*</span>
                </label>
                <select
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  required
                  className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                >
                  <option value="" disabled>
                    Select Department...
                  </option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Job Title Selector (Predefined or Custom) */}
            <div className="pt-1">
              <JobTitleCombobox
                jobTitles={jobTitles}
                value={jobTitle}
                onChange={(newTitle, isCustom) => {
                  setJobTitle(newTitle);
                  setIsCustomJobTitle(isCustom);
                }}
                selectedDepartmentId={departmentId}
              />
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-3 pt-1">
              {/* Base Salary */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Base Monthly Salary <span className="text-[var(--color-status-error)]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="50"
                    required
                    value={baseSalary}
                    onChange={(e) => setBaseSalary(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="3500"
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-9 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <DollarSign className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>

              {/* Hire Date */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  Hire Date <span className="text-[var(--color-status-error)]">*</span>
                </label>
                <div className="relative">
                  <input
                    type="date"
                    required
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-10 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                  <Calendar className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>

              {/* Role */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                  System Role
                </label>
                <div className="relative">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as "employee" | "manager" | "hr_admin")}
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3.5 py-2 pl-9 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  >
                    <option value="employee">Employee</option>
                    <option value="manager">Team Lead / Manager</option>
                    <option value="hr_admin">HR Administrator</option>
                  </select>
                  <Shield className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
                </div>
              </div>
            </div>

            {/* Status radio / toggle */}
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div>
                <p className="text-xs font-semibold text-[var(--color-text-primary)]">Employment Status</p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Inactive employees cannot request leave or receive monthly payroll.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setStatus("active")}
                  className={`min-h-[40px] px-4 rounded-[var(--radius-pill)] text-xs font-semibold transition-colors flex items-center justify-center ${
                    status === "active"
                      ? "bg-[#176247] text-white"
                      : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                  }`}
                >
                  Active
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("inactive")}
                  className={`min-h-[40px] px-4 rounded-[var(--radius-pill)] text-xs font-semibold transition-colors flex items-center justify-center ${
                    status === "inactive"
                      ? "bg-[#a43434] text-white"
                      : "bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]"
                  }`}
                >
                  Inactive
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-[var(--color-border-subtle)]">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-5 text-sm font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-6 text-sm font-bold text-[var(--color-action-on-primary)] transition-colors hover:bg-[var(--color-action-hover)] disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isEditing ? "Save Changes" : "Create Employee"}
              </button>
            </div>
          </form>
          </>
          )}
        </div>
      </div>
    </Portal>
);
}
