"use client";

import { confirmAction } from "@/shared/components/ui/confirm-dialog";
import { useState, useTransition } from "react";
import {
  X, Plus, Trash2, Briefcase, Search, Loader2,
  ShieldCheck, Tag, Edit3, Save, AlertCircle, ChevronLeft,
  Users, UserCheck, UserX, ChevronRight,
} from "lucide-react";
import type { JobTitle, Department, Employee } from "@/features/hr/types";
import {
  createJobTitleAction,
  updateJobTitleAction,
  deleteJobTitleAction,
  fetchJobTitleStaffAction,
} from "@/features/hr/actions/job-title.action";
import { cn } from "@/shared/lib/utils";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";
import { Portal } from "@/shared/components/ui/portal";

type JobTitlesModalProps = {
  isOpen: boolean;
  onClose: () => void;
  jobTitles: JobTitle[];
  departments: Department[];
  onRefresh?: () => void;
};

type View = "list" | "create" | "edit" | "staff";
type FilterTab = "all" | "predefined" | "custom";

export function JobTitlesModal({
  isOpen,
  onClose,
  jobTitles,
  departments,
  onRefresh,
}: JobTitlesModalProps) {
  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<View>("list");
  const [editTarget, setEditTarget] = useState<JobTitle | null>(null);
  const [staffTarget, setStaffTarget] = useState<JobTitle | null>(null);
  const [staffList, setStaffList] = useState<Employee[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  // List state
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [filterDeptId, setFilterDeptId] = useState("");

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formDeptId, setFormDeptId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const predefinedCount = jobTitles.filter((t) => t.isPredefined).length;
  const customCount = jobTitles.filter((t) => !t.isPredefined).length;

  // Apply filters
  const filtered = jobTitles.filter((t) => {
    const matchesSearch = t.title.toLowerCase().includes(search.toLowerCase());
    const matchesTab =
      filterTab === "all" ||
      (filterTab === "predefined" && t.isPredefined) ||
      (filterTab === "custom" && !t.isPredefined);
    const matchesDept = !filterDeptId || t.departmentId === filterDeptId;
    return matchesSearch && matchesTab && matchesDept;
  });

  const resetForm = () => {
    setFormTitle("");
    setFormDeptId("");
    setError(null);
    setSuccess(null);
  };

  const goToCreate = () => {
    resetForm();
    setView("create");
  };

  const goToEdit = (t: JobTitle) => {
    setEditTarget(t);
    setFormTitle(t.title);
    setFormDeptId(t.departmentId ?? "");
    setError(null);
    setSuccess(null);
    setView("edit");
  };

  const goToStaff = async (t: JobTitle) => {
    setStaffTarget(t);
    setLoadingStaff(true);
    setView("staff");
    const result = await fetchJobTitleStaffAction(t.title);
    setStaffList(result.data ?? []);
    setLoadingStaff(false);
  };

  const goBack = () => {
    setView("list");
    resetForm();
    setEditTarget(null);
    setStaffTarget(null);
    setStaffList([]);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = formTitle.trim();
    if (!trimmed) { setError("Please enter a job title."); return; }

    startTransition(async () => {
      const res = await createJobTitleAction(trimmed, formDeptId || undefined);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`"${trimmed}" added.`);
        onRefresh?.();
        setTimeout(goBack, 700);
      }
    });
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setError(null);
    setSuccess(null);
    const trimmed = formTitle.trim();
    if (!trimmed) { setError("Please enter a job title."); return; }

    startTransition(async () => {
      const res = await updateJobTitleAction(editTarget.id, trimmed, formDeptId || undefined);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`Renamed to "${trimmed}".`);
        onRefresh?.();
        setTimeout(goBack, 700);
      }
    });
  };

  const handleDelete = async (item: JobTitle) => {
    if (!(await confirmAction({ title: `Remove "${item.title}"?`, message: "This job title is removed from the list.", tone: "danger", confirmLabel: "Remove" }))) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await deleteJobTitleAction(item.id);
      if (res.error) {
        setError(res.error);
      } else {
        setSuccess(`"${item.title}" deleted.`);
        onRefresh?.();
      }
    });
  };

  const deptName = (id?: string) =>
    id ? (departments.find((d) => d.id === id)?.name ?? id) : null;

  const titles: Record<View, string> = {
    list: "Job Title Management",
    create: "Add Job Title",
    edit: `Edit: ${editTarget?.title ?? ""}`,
    staff: `Staff — ${staffTarget?.title ?? ""}`,
  };

  const subtitles: Record<View, string> = {
    list: `${predefinedCount} predefined · ${customCount} custom`,
    create: "Add a new reusable job title",
    edit: "Rename or reassign department for this job title",
    staff: `${staffTarget?.employeeCount ?? 0} employee${(staffTarget?.employeeCount ?? 0) !== 1 ? "s" : ""} with this title`,
  };

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Job titles" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-xl max-h-[92dvh] sm:max-h-[88vh] flex flex-col rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-2xl overflow-hidden pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile Sheet Drag Handle */}
          <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mt-2.5 mb-1 sm:hidden shrink-0" />

          {/* ── Header ────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 border-b border-[var(--color-border-subtle)] px-4 py-3 sm:px-5 sm:py-4 shrink-0">
            {view !== "list" && (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back to list"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            {view === "list" && (
              <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)] shrink-0">
                <Briefcase className="h-5 w-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-base sm:text-lg font-bold tracking-tight text-[var(--color-text-primary)] truncate">
                {titles[view]}
              </h2>
              <p className="text-xs text-[var(--color-text-secondary)] truncate">
                {subtitles[view]}
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

          {/* ── Feedback ──────────────────────────────────────────────────────── */}
          {error && (
            <div className="mx-4 sm:mx-5 mt-3 flex items-start gap-2 rounded-[var(--radius-control)] border border-[var(--color-status-error)]/30 bg-[var(--color-status-error-bg)] p-3 text-xs text-[var(--color-status-error)] font-medium shrink-0">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="mx-4 sm:mx-5 mt-3 rounded-[var(--radius-control)] border border-[var(--color-status-success)]/30 bg-[var(--color-status-success-bg)] p-3 text-xs text-[var(--color-status-success)] font-medium shrink-0">
              {success}
            </div>
          )}

          {/* ── List view controls ─────────────────────────────────────────────── */}
          {view === "list" && (
            <div className="px-4 pt-3 sm:px-5 sm:pt-4 space-y-2.5 sm:space-y-3 shrink-0">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search job titles..."
                  className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-3 pl-9 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)]"
                />
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-secondary)]" />
              </div>

              {/* Filter tabs & Department dropdown */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] p-0.5 overflow-x-auto w-full sm:w-auto">
                  {(["all", "predefined", "custom"] as FilterTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setFilterTab(tab)}
                      className={cn(
                        "flex-1 sm:flex-initial min-h-[38px] sm:min-h-[32px] rounded-[calc(var(--radius-control)-2px)] px-3 text-xs font-semibold capitalize transition-colors text-center justify-center",
                        filterTab === tab
                          ? "bg-[var(--color-action-primary)] text-[var(--color-action-on-primary)]"
                          : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                      )}
                    >
                      {tab} {tab === "all" ? `(${jobTitles.length})` : tab === "predefined" ? `(${predefinedCount})` : `(${customCount})`}
                    </button>
                  ))}
                </div>

                {/* Department filter */}
                <select
                  value={filterDeptId}
                  onChange={(e) => setFilterDeptId(e.target.value)}
                  className="min-h-[42px] sm:min-h-[36px] w-full sm:w-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-2.5 text-base sm:text-xs text-[var(--color-text-primary)] focus:outline-none"
                >
                  <option value="">All Departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* ── Scrollable content ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">

            {/* LIST */}
            {view === "list" && (
              <>
                {filtered.length === 0 && (
                  <div className="py-10 text-center text-xs text-[var(--color-text-secondary)]">
                    No matching job titles. Try adjusting the filters.
                  </div>
                )}
                {filtered.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2.5 sm:gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3 hover:border-[var(--color-border-control)] transition-colors"
                  >
                    {/* Badge */}
                    {item.isPredefined ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-secondary)]">
                        <ShieldCheck className="h-3 w-3" /> Predefined
                      </span>
                    ) : (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#fbf2da] px-2 py-0.5 text-[10px] font-semibold text-[#7b5915]">
                        <Tag className="h-3 w-3" /> Custom
                      </span>
                    )}

                    {/* Title + department */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{item.title}</p>
                      {deptName(item.departmentId) && (
                        <p className="text-[11px] text-[var(--color-text-secondary)] truncate">{deptName(item.departmentId)}</p>
                      )}
                    </div>

                    {/* Staff count badge */}
                    <button
                      type="button"
                      onClick={() => goToStaff(item)}
                      title="View staff with this job title"
                      className="flex min-h-[36px] items-center gap-1.5 rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>{item.employeeCount ?? 0}</span>
                    </button>

                    {/* Actions — visible on mobile, hover-reveal on desktop */}
                    <div
                      className={cn(
                        "flex items-center gap-0.5 sm:gap-1 transition-opacity shrink-0",
                        item.isPredefined ? "opacity-0 pointer-events-none" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => goToEdit(item)}
                        title="Edit job title"
                        aria-label={`Edit ${item.title}`}
                        className="flex min-h-[38px] min-w-[38px] sm:h-8 sm:w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)] transition-colors"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item)}
                        title={
                          (item.employeeCount ?? 0) > 0
                            ? "Cannot delete — title is assigned to employees"
                            : "Delete job title"
                        }
                        aria-label={`Delete ${item.title}`}
                        disabled={(item.employeeCount ?? 0) > 0 || isPending}
                        className="flex min-h-[38px] min-w-[38px] sm:h-8 sm:w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-status-error)] hover:bg-[var(--color-status-error-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>

                    {/* Chevron to staff */}
                    <button
                      type="button"
                      onClick={() => goToStaff(item)}
                      title="View staff"
                      aria-label={`View staff with title ${item.title}`}
                      className="flex min-h-[38px] min-w-[32px] sm:h-8 sm:w-8 items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] shrink-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </>
            )}

            {/* CREATE */}
            {view === "create" && (
              <form onSubmit={handleCreate} className="space-y-3.5 pt-1">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Job Title Name <span className="text-[var(--color-status-error)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    autoFocus
                    placeholder="e.g. AI Workflow Specialist"
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-base sm:text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Associated Department <span className="text-[var(--color-text-secondary)] font-normal normal-case">(optional)</span>
                  </label>
                  <select
                    value={formDeptId}
                    onChange={(e) => setFormDeptId(e.target.value)}
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  >
                    <option value="">No specific department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-4 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !formTitle.trim()}
                    className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Title
                  </button>
                </div>
              </form>
            )}

            {/* EDIT */}
            {view === "edit" && editTarget && (
              <form onSubmit={handleEdit} className="space-y-3.5 pt-1">
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Job Title Name <span className="text-[var(--color-status-error)]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    autoFocus
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                    Associated Department
                  </label>
                  <select
                    value={formDeptId}
                    onChange={(e) => setFormDeptId(e.target.value)}
                    className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-base sm:text-sm text-[var(--color-text-primary)] focus:outline-none"
                  >
                    <option value="">No specific department</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                {(editTarget.employeeCount ?? 0) > 0 && (
                  <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)] px-3 py-2.5 text-xs text-[var(--color-text-secondary)]">
                    ⚠ Renaming will automatically update {editTarget.employeeCount} employee record{(editTarget.employeeCount ?? 0) > 1 ? "s" : ""} assigned this title.
                  </div>
                )}
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-4 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isPending || !formTitle.trim()}
                    className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-5 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Changes
                  </button>
                </div>
              </form>
            )}

            {/* STAFF */}
            {view === "staff" && (
              <>
                {loadingStaff && (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-secondary)]" />
                  </div>
                )}
                {!loadingStaff && staffList.length === 0 && (
                  <div className="py-10 text-center">
                    <Users className="mx-auto h-8 w-8 text-[var(--color-text-secondary)] mb-2" />
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">No employees assigned</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                      No staff members currently have this job title. Assign it when adding or editing employees.
                    </p>
                  </div>
                )}
                {!loadingStaff && staffList.map((emp) => {
                  const initials = (() => {
                    const parts = emp.fullName.trim().split(/\s+/).filter(Boolean);
                    if (parts.length === 0) return "?";
                    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
                    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                  })();

                  return (
                    <div
                      key={emp.id}
                      className="flex items-center gap-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-3"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-action-primary)] text-xs font-bold text-[var(--color-action-on-primary)]">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-[var(--color-text-primary)] truncate">{emp.fullName}</p>
                        <p className="text-[11px] text-[var(--color-text-secondary)] truncate">
                          {emp.departmentName || "No Department"} · {emp.email}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold shrink-0",
                          emp.status === "active"
                            ? "bg-[#e9f2ea] text-[#176247]"
                            : "bg-[#fff1ee] text-[#a43434]"
                        )}
                      >
                        {emp.status === "active"
                          ? <UserCheck className="h-3 w-3" />
                          : <UserX className="h-3 w-3" />
                        }
                        {emp.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* ── Footer ────────────────────────────────────────────────────────── */}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 border-t border-[var(--color-border-subtle)] px-4 py-3 sm:px-5 shrink-0">
            {view === "list" ? (
              <>
                <span className="text-xs text-[var(--color-text-secondary)] text-center sm:text-left">
                  Tap edit or delete to manage custom titles
                </span>
                <button
                  type="button"
                  onClick={goToCreate}
                  className="flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)]"
                >
                  <Plus className="h-4 w-4" />
                  New Title
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={goBack}
                className="flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] px-5 text-xs font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]"
              >
                ← Back to list
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
);
}
