import { auth } from "@/server/auth";
import { SiteHeader } from "@/shared/components/marketing/site-header";
import { SiteFooter } from "@/shared/components/marketing/site-footer";
import { RevealObserver } from "@/shared/components/portal/reveal-observer";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--color-bg-canvas)] text-[var(--color-text-primary)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-[var(--color-bg-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      <SiteHeader user={session?.user} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
