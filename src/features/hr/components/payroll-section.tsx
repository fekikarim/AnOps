"use client";

import { useState, useTransition, useMemo } from "react";
import {
  DollarSign,
  Calculator,
  FileText,
  Printer,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Info,
} from "lucide-react";
import type { Employee, PayslipRecord, PayrollSummary } from "@/features/hr/types";
import { PayslipModal } from "./payslip-modal";
import {
  generatePayslipsAction,
  getPayslipsAction,
  getPayrollSummaryAction,
} from "@/features/hr/actions/payroll.action";

type PayrollSectionProps = {
  initialPayslips: PayslipRecord[];
  initialSummary: PayrollSummary;
  employees: Employee[];
  currentEmployee?: Employee | null;
  onRefresh: () => void;
  userRole?: "employee" | "manager" | "hr_admin";
};

export function PayrollSection({
  initialPayslips,
  initialSummary,
  employees,
  currentEmployee,
  onRefresh,
  userRole = "employee",
}: PayrollSectionProps) {
  const [isPending, startTransition] = useTransition();
  const isAdmin = userRole === "hr_admin";

  // Selected period e.g. "2026-10"
  const [period, setPeriod] = useState<string>(initialSummary.period || "2026-10");
  const [payslips, setPayslips] = useState<PayslipRecord[]>(initialPayslips);
  const [summary, setSummary] = useState<PayrollSummary>(initialSummary);

  const [search, setSearch] = useState("");
  const [selectedPayslip, setSelectedPayslip] = useState<PayslipRecord | null>(null);
  const [payslipModalOpen, setPayslipModalOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Load data when period changes
  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
    setActionMessage(null);

    startTransition(async () => {
      const [slipRes, sumRes] = await Promise.all([
        getPayslipsAction(newPeriod),
        getPayrollSummaryAction(newPeriod),
      ]);

      if (slipRes.data) setPayslips(slipRes.data);
      if (sumRes.data) setSummary(sumRes.data);
    });
  };

  // Generate payslips for the period
  const handleGeneratePayroll = () => {
    setActionMessage(null);

    startTransition(async () => {
      const res = await generatePayslipsAction({
        period,
        workingDaysInMonth: 22,
      });

      if (res.error) {
        setActionMessage({ type: "error", text: res.error });
      } else {
        const generatedCount = res.data?.length ?? 0;
        setActionMessage({
          type: "success",
          text: `Successfully generated ${generatedCount} payslip(s) for period ${period}. Any unpaid leaves were automatically deducted.`,
        });

        // Re-fetch period data
        const [slipRes, sumRes] = await Promise.all([
          getPayslipsAction(period),
          getPayrollSummaryAction(period),
        ]);
        if (slipRes.data) setPayslips(slipRes.data);
        if (sumRes.data) setSummary(sumRes.data);
        onRefresh();
      }
    });
  };

  const filteredPayslips = useMemo(() => {
    if (!search.trim()) return payslips;
    const query = search.toLowerCase();
    return payslips.filter(
      (p) =>
        p.employeeName.toLowerCase().includes(query) ||
        p.jobTitle.toLowerCase().includes(query) ||
        p.departmentName.toLowerCase().includes(query)
    );
  }, [payslips, search]);

  const handleOpenPayslip = (slip: PayslipRecord) => {
    setSelectedPayslip(slip);
    setPayslipModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Formula & Policy Guidance Banner */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-action-primary)]/15 text-[var(--color-action-on-primary)] shrink-0 mt-0.5">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-tight text-[var(--color-text-primary)]">
                  Net Salary & Unpaid Leave Calculation Engine
                </h3>
                <span className="hidden sm:inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-500/20">
                  22 Working Days/Mo
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Standard monthly salary formula deducting uncompensated leave days in Tunisian Dinars (TND):
              </p>
            </div>
          </div>

          {/* Period Selector & Batch Generate CTA */}
          <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 w-full lg:w-auto shrink-0">
            <div className="w-full sm:w-auto">
              <label className="block text-[10px] font-bold uppercase text-[var(--color-text-secondary)] mb-1">
                Pay Period
              </label>
              <input
                type="month"
                value={period}
                onChange={(e) => handlePeriodChange(e.target.value)}
                disabled={isPending}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-xs font-bold text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)] cursor-pointer"
              />
            </div>

            {isAdmin && (
            <button
              type="button"
              onClick={handleGeneratePayroll}
              disabled={isPending}
              className="flex min-h-[44px] sm:min-h-[40px] w-full sm:w-auto items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-4 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-all shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Computing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Generate Payslips</span>
                </>
              )}
            </button>
            )}
          </div>
        </div>

        {/* Mathematical Steps & Live Example */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-[var(--color-bg-subtle)]/50 p-3 rounded-[var(--radius-control)]">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] font-bold text-[var(--color-text-primary)] shadow-2xs">
              Daily Rate = Base Salary ÷ 22
            </span>
            <span className="text-[var(--color-text-secondary)] font-bold">→</span>
            <span className="px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/25 font-bold text-amber-800 shadow-2xs">
              Deduction = Daily Rate × Unpaid Days
            </span>
            <span className="text-[var(--color-text-secondary)] font-bold">→</span>
            <span className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 font-black text-emerald-800 shadow-2xs">
              Net Pay = Base Salary − Deduction
            </span>
          </div>

          <div className="text-[11px] font-mono text-[var(--color-text-secondary)]">
            <span className="font-bold text-[var(--color-text-primary)]">Verified Rule:</span> Paid leave (Annual/Sick) has <strong className="text-emerald-600">0 TND deduction</strong>
          </div>
        </div>
      </div>

      {actionMessage && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-[var(--radius-control)] p-3 text-xs font-medium ${
              actionMessage.type === "success"
                ? "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] border border-[var(--color-status-success)]/30"
                : "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] border border-[var(--color-status-error)]/30"
            }`}
          >
            {actionMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{actionMessage.text}</span>
          </div>
        )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Gross */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Total Gross Payroll</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {summary.totalGross.toLocaleString()}
            </span>
            <span className="text-xs font-bold text-[var(--color-text-secondary)]">TND</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Contractual base salaries</p>
        </div>

        {/* Unpaid Deductions */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Unpaid Leave Deductions</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-status-error)]">
              {summary.totalDeductions > 0 ? `-${summary.totalDeductions.toLocaleString()}` : "0"}
            </span>
            <span className="text-xs font-bold text-[var(--color-text-secondary)]">TND</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Based on approved unpaid days</p>
        </div>

        {/* Net Payroll */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-action-primary)]/40 bg-[var(--color-action-primary)]/10 p-4 shadow-xs">
          <p className="text-xs font-bold text-[var(--color-text-primary)]">Total Net Disbursement</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold tracking-tight text-[var(--color-text-primary)]">
              {summary.totalNet.toLocaleString()}
            </span>
            <span className="text-xs font-bold text-[var(--color-text-primary)]">TND</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-primary)]">Net bank transfer total</p>
        </div>

        {/* Generated Count */}
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 shadow-xs">
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">Generated Payslips</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
              {summary.payslipsGenerated}
            </span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              / {summary.totalEmployees} active
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">Period: {period}</p>
        </div>
      </div>

      {/* Payslips Table Card */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">
              Employee Payslip Records ({period})
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              View individual breakdowns, deductions, and print official payslips
            </p>
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-auto sm:min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
            <input
              type="text"
              placeholder="Search staff, job title..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full min-h-[42px] sm:min-h-[38px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] pl-8 pr-3 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-action-primary)]"
            />
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-bold text-[10px] uppercase">
              <tr>
                <th className="px-4 py-3">Staff Member</th>
                <th className="px-4 py-3">Department & Role</th>
                <th className="px-4 py-3 text-right">Base Salary</th>
                <th className="px-4 py-3 text-center">Unpaid Days</th>
                <th className="px-4 py-3 text-right">Deduction</th>
                <th className="px-4 py-3 text-right">Net Salary</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
              {filteredPayslips.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--color-text-secondary)]">
                    <FileText className="mx-auto h-8 w-8 opacity-40 mb-2" />
                    <p className="font-semibold text-sm">No payslips generated for period {period}</p>
                    <p className="text-xs mt-1">
                      Click the &quot;Generate Payslips&quot; button above to compute salaries and deductions.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredPayslips.map((slip) => (
                  <tr key={slip.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                    {/* Staff */}
                    <td className="px-4 py-3">
                      <div className="font-bold text-[var(--color-text-primary)]">
                        {slip.employeeName}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-secondary)]">
                        Ref: PAY-{slip.period}
                      </div>
                    </td>

                    {/* Dept */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text-primary)]">
                        {slip.jobTitle}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-secondary)]">
                        {slip.departmentName}
                      </div>
                    </td>

                    {/* Base */}
                    <td className="px-4 py-3 text-right font-bold text-[var(--color-text-primary)]">
                      {slip.baseSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })} {slip.currency}
                    </td>

                    {/* Unpaid Days */}
                    <td className="px-4 py-3 text-center">
                      {slip.unpaidLeaveDays > 0 ? (
                        <span className="inline-block rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning-text)]">
                          {slip.unpaidLeaveDays} day(s)
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)]">0</span>
                      )}
                    </td>

                    {/* Deduction */}
                    <td className="px-4 py-3 text-right font-semibold">
                      {slip.deduction > 0 ? (
                        <span className="text-[var(--color-status-error)]">
                          -{slip.deduction.toLocaleString(undefined, { minimumFractionDigits: 2 })} {slip.currency}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)]">0.00</span>
                      )}
                    </td>

                    {/* Net Salary */}
                    <td className="px-4 py-3 text-right font-extrabold text-[var(--color-text-primary)]">
                      {slip.netSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })} {slip.currency}
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenPayslip(slip)}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3 py-1.5 text-xs font-bold text-[var(--color-text-primary)] hover:border-[var(--color-border-control)] hover:bg-[var(--color-bg-subtle)] transition-colors shadow-xs"
                      >
                        <Printer className="h-3.5 w-3.5 text-[var(--color-text-secondary)]" />
                        <span>View Payslip</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="md:hidden divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden">
          {filteredPayslips.length === 0 ? (
            <div className="p-6 text-center text-[var(--color-text-secondary)]">
              <FileText className="mx-auto h-8 w-8 opacity-40 mb-2" />
              <p className="font-semibold text-xs">No payslips generated for period {period}</p>
              <p className="text-[11px] mt-1 text-[var(--color-text-secondary)]">
                Click &quot;Generate Payslips&quot; above to compute.
              </p>
            </div>
          ) : (
            filteredPayslips.map((slip) => (
              <div key={slip.id} className="p-3.5 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-sm text-[var(--color-text-primary)]">
                      {slip.employeeName}
                    </p>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {slip.jobTitle} • {slip.departmentName}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-extrabold text-[var(--color-text-primary)] block">
                      {slip.netSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })} {slip.currency}
                    </span>
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                      Net Salary
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Base Salary
                    </span>
                    <p className="font-semibold text-[var(--color-text-primary)] mt-0.5 truncate">
                      {slip.baseSalary.toLocaleString()} {slip.currency}
                    </p>
                  </div>

                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Unpaid
                    </span>
                    <p className="font-semibold text-[var(--color-text-primary)] mt-0.5">
                      {slip.unpaidLeaveDays} day(s)
                    </p>
                  </div>

                  <div className="rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] p-2">
                    <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)] block">
                      Deduction
                    </span>
                    <p className={`font-semibold mt-0.5 truncate ${slip.deduction > 0 ? "text-[var(--color-status-error)]" : "text-[var(--color-text-secondary)]"}`}>
                      {slip.deduction > 0 ? `-${slip.deduction.toLocaleString()}` : "0.00"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenPayslip(slip)}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)] font-bold text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors"
                >
                  <Printer className="h-4 w-4 text-[var(--color-text-secondary)]" />
                  <span>View Official Payslip</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Printable Payslip Modal */}
      <PayslipModal
        isOpen={payslipModalOpen}
        onClose={() => setPayslipModalOpen(false)}
        payslip={selectedPayslip}
      />
    </div>
  );
}
