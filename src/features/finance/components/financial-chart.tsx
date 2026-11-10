"use client";

import { useState } from "react";

type MonthData = {
  monthKey: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
};

export function FinancialChart({
  monthlySummary,
  currency = "TND",
}: {
  monthlySummary: MonthData[];
  currency?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const maxVal = Math.max(
    ...monthlySummary.map((m) => Math.max(m.income, m.expenses)),
    100
  );

  const totalIncome = monthlySummary.reduce((acc, m) => acc + m.income, 0);
  const totalExpenses = monthlySummary.reduce((acc, m) => acc + m.expenses, 0);
  const netTotal = totalIncome - totalExpenses;

  const fmt = (n: number) =>
    new Intl.NumberFormat("fr-TN", { style: "currency", currency }).format(n || 0);

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-6 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Income vs. Expenses (Last 6 Months)
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Cash inflow from settled payments vs. operational and capital expenses
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
            <span className="text-[var(--color-text-secondary)]">Income</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block" />
            <span className="text-[var(--color-text-secondary)]">Expenses</span>
          </div>
        </div>
      </div>

      {/* Bar Chart Visualization */}
      <div className="pt-6 pb-2">
        <div className="h-52 flex items-end justify-between gap-2 sm:gap-6 px-2 border-b border-[var(--color-border-subtle)]">
          {monthlySummary.map((m, idx) => {
            const incomeHeight = Math.max(4, Math.round((m.income / maxVal) * 100));
            const expenseHeight = Math.max(4, Math.round((m.expenses / maxVal) * 100));
            const isHovered = hoveredIndex === idx;

            return (
              <div
                key={m.monthKey}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                className="flex-1 flex flex-col items-center h-full justify-end group relative cursor-pointer"
              >
                {/* Floating Tooltip */}
                {isHovered && (
                  <div className="absolute -top-16 z-20 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] shadow-lg rounded-lg p-2 text-xs min-w-[150px] pointer-events-none animate-in fade-in">
                    <div className="font-semibold text-[var(--color-text-primary)] mb-1">
                      {m.label}
                    </div>
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Income:</span>
                      <span className="font-medium">{fmt(m.income)}</span>
                    </div>
                    <div className="flex justify-between text-rose-600 dark:text-rose-400">
                      <span>Expenses:</span>
                      <span className="font-medium">{fmt(m.expenses)}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-[var(--color-border-subtle)] font-semibold text-[var(--color-text-primary)]">
                      <span>Net:</span>
                      <span className={m.net >= 0 ? "text-emerald-600" : "text-rose-600"}>
                        {fmt(m.net)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Bars */}
                <div className="w-full flex items-end justify-center gap-1 sm:gap-2 h-full">
                  {/* Income Bar */}
                  <div
                    style={{ height: `${incomeHeight}%` }}
                    className="w-full max-w-[28px] rounded-t bg-emerald-500/85 hover:bg-emerald-500 transition-all duration-300 relative"
                  />
                  {/* Expense Bar */}
                  <div
                    style={{ height: `${expenseHeight}%` }}
                    className="w-full max-w-[28px] rounded-t bg-rose-500/85 hover:bg-rose-500 transition-all duration-300 relative"
                  />
                </div>

                {/* X-axis Label */}
                <div className="mt-2 text-[11px] font-medium text-[var(--color-text-secondary)] truncate text-center w-full">
                  {m.label.slice(0, 3)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Breakdown Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="text-[var(--color-text-secondary)] border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/30">
            <tr>
              <th className="py-2 px-3 font-medium">Month</th>
              <th className="py-2 px-3 font-medium text-right">Income</th>
              <th className="py-2 px-3 font-medium text-right">Expenses</th>
              <th className="py-2 px-3 font-medium text-right">Net Flow</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-subtle)] text-[var(--color-text-primary)]">
            {monthlySummary.map((m) => (
              <tr key={m.monthKey} className="hover:bg-[var(--color-bg-subtle)]/20">
                <td className="py-2 px-3 font-medium">{m.label}</td>
                <td className="py-2 px-3 text-right font-medium text-emerald-600 dark:text-emerald-400">
                  {fmt(m.income)}
                </td>
                <td className="py-2 px-3 text-right font-medium text-rose-600 dark:text-rose-400">
                  {fmt(m.expenses)}
                </td>
                <td className={`py-2 px-3 text-right font-semibold ${m.net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {fmt(m.net)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[var(--color-border-subtle)] font-semibold text-[var(--color-text-primary)] bg-[var(--color-bg-subtle)]/50">
            <tr>
              <td className="py-2.5 px-3">6-Month Total</td>
              <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400">
                {fmt(totalIncome)}
              </td>
              <td className="py-2.5 px-3 text-right text-rose-600 dark:text-rose-400">
                {fmt(totalExpenses)}
              </td>
              <td className={`py-2.5 px-3 text-right ${netTotal >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {fmt(netTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
