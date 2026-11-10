import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { apps } from "@/shared/config/catalog";
import { cn } from "@/shared/lib/utils";

/** A faithful, static miniature of the AnOps home (/anops): greeting, organization, app grid and Dock. */
export function WorkspaceMock({ compact = false, className, animateIn = false }: { compact?: boolean; className?: string; animateIn?: boolean }) {
  const grid = apps.slice(0, compact ? 6 : 8);
  return (
    <div className={cn("relative overflow-hidden bg-[#111F1D] text-[#F7F7F2]", className)}>
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)]" />
      <div className="relative flex items-center justify-between px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
          <img src="/brand-kit/02-app-icons/anops-app-icon-ios-192x192.svg" alt="" width={22} height={22} className="h-5 w-5 rounded-[6px] sm:h-6 sm:w-6" />
          <span className="text-[11px] font-semibold sm:text-xs">AnOps</span>
        </div>
        <span className="rounded-full border border-white/15 px-2.5 py-1 text-[10px] text-[#B4BFB7] sm:text-[11px]">Qovri · AllOps</span>
      </div>
      <div className="relative px-4 pt-5 sm:px-6 sm:pt-7">
        <p className="text-[10px] uppercase tracking-[0.14em] text-[#B4BFB7] sm:text-[11px]">Good morning</p>
        <p className="mt-1 font-[family-name:var(--font-heading)] text-lg font-semibold tracking-[-0.03em] sm:text-2xl">Amira, your workspace is ready.</p>
        <div className="mt-3 flex h-8 items-center gap-2 rounded-[10px] border border-white/10 bg-white/5 px-3 text-[11px] text-[#B4BFB7] sm:h-9">
          <span aria-hidden="true">⌕</span> Search apps, people, records… <kbd className="ml-auto rounded border border-white/15 px-1.5 text-[10px]">⌘K</kbd>
        </div>
      </div>
      <ul className={cn("relative grid gap-3 px-4 pb-20 pt-5 sm:gap-4 sm:px-6 sm:pb-24", compact ? "grid-cols-3" : "grid-cols-4")}>
        {grid.map((app, index) => (
          <li key={app.slug} className={cn("flex flex-col items-center gap-1.5 text-center", animateIn && "home-pop")} style={{ ["--d" as string]: `${200 + index * 70}ms` }}>
            <AnimatedIcon icon={app.icon} size={compact ? 40 : 48} play="never" className="max-sm:!h-10 max-sm:!w-10" />
            <span className="w-full truncate text-[10px] text-[#D9E0DA] sm:text-[11px]">{app.name}</span>
          </li>
        ))}
      </ul>
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <div className="flex items-center gap-1.5 rounded-[16px] border border-white/10 bg-white/10 p-1.5 backdrop-blur-md sm:gap-2 sm:p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
          <img src="/brand-kit/02-app-icons/anops-app-icon-ios-192x192.svg" alt="" width={32} height={32} className="h-7 w-7 rounded-[8px] sm:h-8 sm:w-8" />
          <span className="mx-0.5 h-6 w-px bg-white/15" />
          {apps.slice(0, compact ? 4 : 6).map((app) => (
            <AnimatedIcon key={app.slug} icon={app.icon} size={32} play="never" className="max-sm:!h-7 max-sm:!w-7" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Browser chrome around a product screen. */
export function BrowserFrame({ url, children, className }: { url: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-[18px] border border-black/10 bg-[#192B27] shadow-[0_50px_120px_-40px_rgba(17,31,29,0.65)] dark:border-white/10", className)}>
      <div className="flex h-9 items-center gap-3 border-b border-white/10 bg-[#0E1A18] px-3.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="mx-auto max-w-[60%] truncate rounded-[6px] bg-white/5 px-3 py-0.5 text-[11px] text-[#B4BFB7]">{url}</span>
        <span className="w-[42px]" aria-hidden="true" />
      </div>
      {children}
    </div>
  );
}
