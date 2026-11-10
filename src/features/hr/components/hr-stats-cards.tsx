"use client";

import type { HRDashboardStats } from "@/features/hr/types";
import { Users, UserCheck, DollarSign, Briefcase } from "lucide-react";

type HRStatsCardsProps = {
  stats: HRDashboardStats;
};

export function HRStatsCards({ stats }: HRStatsCardsProps) {
  const cards = [
    {
      label: "Total Personnel",
      value: stats.totalEmployees,
      sub: `${stats.activeEmployees} active · ${stats.inactiveEmployees} inactive`,
      icon: Users,
    },
    {
      label: "Active Staff",
      value: `${Math.round((stats.activeEmployees / (stats.totalEmployees || 1)) * 100)}%`,
      sub: `${stats.activeEmployees} of ${stats.totalEmployees} employees active`,
      icon: UserCheck,
    },
    {
      label: "Gross Monthly Payroll",
      value: `${stats.monthlyPayrollGross.toLocaleString()} TND`,
      sub: `Avg. ${stats.averageSalary.toLocaleString()} TND / employee`,
      icon: DollarSign,
    },
    {
      label: "Job Titles Registered",
      value: stats.jobTitleCount,
      sub: `Across ${stats.departmentCount} departments`,
      icon: Briefcase,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="lift group relative rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide text-[var(--color-text-secondary)] uppercase">
                {c.label}
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-subtle)] text-[var(--color-text-primary)] group-hover:bg-[var(--color-action-primary)] group-hover:text-[var(--color-action-on-primary)] transition-colors">
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-[28px] leading-[32px] font-bold tracking-tight text-[var(--color-text-primary)]">
              {c.value}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              {c.sub}
            </p>
          </div>
        );
      })}
    </div>
  );
}
