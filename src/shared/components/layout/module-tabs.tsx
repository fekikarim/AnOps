"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/lib/utils";

export type ModuleTab = { label: string; href: string; /** Match only this exact path, for a root tab whose siblings live below it. */ exact?: boolean };

/** Section navigation inside a module. Active state follows the current path, including nested routes. */
export function ModuleTabs({ tabs }: { tabs: ModuleTab[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Module sections" className="-mx-1 overflow-x-auto lg:hidden">
      <ul className="flex min-w-max gap-1 border-b border-[var(--color-border-subtle)] px-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || (!tab.exact && pathname.startsWith(`${tab.href}/`));
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-[44px] items-center border-b-2 px-3 text-sm transition-colors",
                  active
                    ? "border-[var(--color-action-primary)] font-semibold text-[var(--color-text-primary)]"
                    : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
