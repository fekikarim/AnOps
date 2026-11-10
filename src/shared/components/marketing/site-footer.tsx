import Link from "next/link";
import { footerGroups, siteTagline } from "@/shared/config/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <img
              src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-dark.svg"
              alt="AnOps"
              className="h-7 block dark:hidden"
            />
            <img
              src="/brand-kit/01-brand-identity/logos/anops-logo-horizontal-white.svg"
              alt="AnOps"
              className="h-7 hidden dark:block"
            />
            <p className="mt-4 max-w-xs text-sm text-[var(--color-text-secondary)]">{siteTagline}</p>
          </div>
          {footerGroups.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">{group.title}</p>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 border-t border-[var(--color-border-subtle)] pt-6 text-xs text-[var(--color-text-secondary)]">
          © {new Date().getFullYear()} AnOps. Application availability is shown on each app page.
        </div>
      </div>
    </footer>
  );
}
