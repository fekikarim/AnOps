"use client";

import { Printer, X, Download, ShieldCheck } from "lucide-react";
import type { PayslipRecord } from "@/features/hr/types";
import { Portal } from "@/shared/components/ui/portal";
import { useScrollLock } from "@/shared/hooks/use-scroll-lock";
import { useDialog } from "@/shared/hooks/use-dialog";

type PayslipModalProps = {
  isOpen: boolean;
  onClose: () => void;
  payslip: PayslipRecord | null;
};

export function PayslipModal({ isOpen, onClose, payslip }: PayslipModalProps) {
  useScrollLock(isOpen);
  const dialogRef = useDialog<HTMLDivElement>(isOpen, onClose);

  if (!isOpen || !payslip) return null;

  const handlePrint = () => {
    window.print();
  };

  const formattedPeriod = () => {
    try {
      const [year, month] = payslip.period.split("-");
      const d = new Date(Number(year), Number(month) - 1, 1);
      return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } catch {
      return payslip.period;
    }
  };

  return (
    <Portal>
      <div role="dialog" ref={dialogRef} tabIndex={-1} aria-modal="true" aria-label="Payslip" className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:items-center overflow-hidden p-0 sm:p-4 bg-black/60 backdrop-blur-xs print:p-0 print:bg-white animate-in fade-in duration-200">
        <div
          className="relative w-full max-w-2xl max-h-[92dvh] sm:max-h-[88vh] overflow-y-auto rounded-t-[calc(var(--radius-card)+6px)] sm:rounded-[var(--radius-card)] border-t sm:border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 sm:p-6 shadow-2xl pb-[max(1rem,env(safe-area-inset-bottom))] print:border-none print:shadow-none print:w-full print:max-w-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile drag handle */}
          <div className="w-10 h-1 rounded-full bg-[var(--color-border-control)] mx-auto mb-3 sm:hidden shrink-0 print:hidden" />

          {/* Top modal action bar (hidden during print) */}
          <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] pb-4 print:hidden">
            <span className="text-xs font-bold text-[var(--color-text-secondary)] uppercase tracking-wider">
              Official Payslip Preview
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrint}
                className="flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-action-primary)] px-3 py-1.5 text-xs font-bold text-[var(--color-action-on-primary)] hover:bg-[var(--color-action-hover)] transition-colors shadow-xs"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print / Save as PDF</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] transition-colors shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Printable Payslip Body */}
          <div className="pt-4 space-y-6 text-[var(--color-text-primary)]">
            {/* Header: Company & Title */}
            <div className="flex items-start justify-between border-b border-[var(--color-border-subtle)] pb-5">
              <div>
                <h1 className="text-2xl font-black tracking-tight text-[var(--color-text-primary)]">
                  AnOps ERP
                </h1>
                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                  Modular Business Management & People Operations
                </p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">
                  Tunis, Tunisia • info@anops.internal
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-full bg-[var(--color-status-success)]/10 px-2.5 py-1 text-xs font-bold text-[var(--color-status-success)]">
                  OFFICIAL PAYSLIP
                </span>
                <div className="mt-1 text-sm font-bold text-[var(--color-text-primary)]">
                  Period: {formattedPeriod()}
                </div>
                <div className="text-[10px] text-[var(--color-text-secondary)] font-mono">
                  Ref: PAY-{payslip.period}-{payslip.employeeId.slice(-6).toUpperCase()}
                </div>
              </div>
            </div>

            {/* Employee Information Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)]/70 p-4 text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                  Employee Name
                </span>
                <div className="font-bold text-sm text-[var(--color-text-primary)] mt-0.5">
                  {payslip.employeeName}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                  Job Title
                </span>
                <div className="font-medium text-xs text-[var(--color-text-primary)] mt-0.5">
                  {payslip.jobTitle}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                  Department
                </span>
                <div className="font-medium text-xs text-[var(--color-text-primary)] mt-0.5">
                  {payslip.departmentName}
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold text-[var(--color-text-secondary)]">
                  Pay Currency
                </span>
                <div className="font-bold text-xs text-[var(--color-text-primary)] mt-0.5">
                  {payslip.currency} (Tunisian Dinar)
                </div>
              </div>
            </div>

            {/* Earnings & Deductions Tables */}
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-[var(--color-border-subtle)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)] font-bold text-[10px] uppercase">
                    <tr>
                      <th className="px-4 py-2.5">Item Description</th>
                      <th className="px-4 py-2.5">Formula / Rate</th>
                      <th className="px-4 py-2.5 text-right">Amount ({payslip.currency})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-subtle)]">
                    {/* Gross Base Salary */}
                    <tr>
                      <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                        Basic Monthly Salary
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                        Contractual Base ({payslip.workingDaysInMonth} standard working days)
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[var(--color-text-primary)]">
                        +{payslip.baseSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                    </tr>

                    {/* Unpaid Leave Deduction */}
                    <tr>
                      <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                        Unpaid Leave Salary Deduction
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-secondary)]">
                        {payslip.unpaidLeaveDays} day(s) × {payslip.dailyRate.toFixed(2)} TND/day
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-[var(--color-status-error)]">
                        {payslip.deduction > 0
                          ? `-${payslip.deduction.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                          : "0.00"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Total Net Payout Banner */}
              <div className="rounded-[var(--radius-control)] border border-[var(--color-action-primary)] bg-[var(--color-action-primary)]/15 p-4 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
                    Net Take-Home Pay
                  </span>
                  <div className="text-2xl sm:text-3xl font-black text-[var(--color-text-primary)]">
                    {payslip.netSalary.toLocaleString(undefined, { minimumFractionDigits: 2 })}{" "}
                    <span className="text-sm font-bold text-[var(--color-text-secondary)]">
                      {payslip.currency}
                    </span>
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--color-text-secondary)]">
                  <div className="flex items-center gap-1 font-semibold text-[var(--color-status-success)]">
                    <ShieldCheck className="h-4 w-4" />
                    <span>Calculated & Verified</span>
                  </div>
                  <div className="text-[10px] mt-0.5">
                    Disbursed via Direct Bank Deposit
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Notes */}
            <div className="border-t border-[var(--color-border-subtle)] pt-4 text-[10px] text-[var(--color-text-secondary)] flex flex-col sm:flex-row items-center justify-between gap-2">
              <p>Generated on {new Date(payslip.generatedAt).toLocaleDateString()} by AnOps Payroll Engine</p>
              <p className="italic">This is a system generated payslip and requires no physical signature.</p>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
