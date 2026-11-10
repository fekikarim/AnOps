"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Section navigation. Phones: a sticky, swipeable pill bar that keeps the active section in view.
 * Desktop: a vertical rail.
 */
export function OrgNav({ orgId, isManager }: { orgId: string; isManager: boolean }) {
  const pathname = usePathname();
  const base = `/organization/${orgId}`;
  const activeRef = useRef<HTMLAnchorElement>(null);
  const items = [
    { label: "Overview", href: base, exact: true },
    { label: "Members", href: `${base}/members` },
    { label: "Billing", long: "Subscription & billing", href: `${base}/billing` },
    { label: "Settings", href: `${base}/settings` },
    ...(isManager ? [{ label: "Audit log", href: `${base}/audit` }] : []),
  ];

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  return (
    <nav
      aria-label="Organization sections"
      className="sticky top-16 z-20 -mx-4 border-y border-[var(--color-border-subtle)] bg-[var(--color-bg-canvas)]/90 backdrop-blur sm:-mx-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:backdrop-blur-none"
    >
      <ul className="flex snap-x gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:px-6 lg:flex-col lg:gap-1 lg:overflow-visible lg:p-0 [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="shrink-0 snap-start lg:shrink">
              <Link
                ref={active ? activeRef : undefined}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] items-center whitespace-nowrap rounded-full px-4 text-sm transition-[background-color,color] duration-200 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--color-focus-ring)] lg:min-h-[42px] lg:rounded-[12px] lg:px-3.5",
                  active
                    ? "bg-[var(--color-text-primary)] font-semibold text-[var(--color-bg-canvas)]"
                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]"
                )}
              >
                <span className="lg:hidden">{item.label}</span>
                <span className="hidden lg:inline">{item.long ?? item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
