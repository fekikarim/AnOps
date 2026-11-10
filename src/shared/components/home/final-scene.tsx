"use client";

import Link from "next/link";
import { useRef } from "react";
import { IconArrowRight } from "@/shared/components/ui/brand-icons";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { btnPrimary, container } from "@/shared/components/marketing/styles";
import { useScrollProgress } from "@/shared/components/home/scroll-scene";
import { apps } from "@/shared/config/catalog";

/** Field positions (percent) and depth for the rising icon field; tuned so nothing sits behind the headline. */
const field = [
  [5, 18, 140], [11, 56, 90], [6, 84, 170], [90, 16, 120], [94, 48, 160],
  [87, 80, 100], [22, 7, 60], [74, 8, 70], [28, 90, 130], [68, 91, 150],
];

/** Scene 6: a closing statement that settles into place while the app icons rise around it. */
export function FinalScene() {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, "enter");
  return (
    <section ref={ref} data-progress className="portal-ink relative overflow-hidden" aria-labelledby="final-title" style={{ ["--p" as string]: 0 }}>
      <div aria-hidden="true" className="portal-grid pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[min(820px,110vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C8F03E] opacity-[0.10] blur-[120px]" />
      <ul aria-hidden="true" className="pointer-events-none absolute inset-0 hidden md:block">
        {apps.slice(0, field.length).map((app, index) => {
          const [x, y, depth] = field[index];
          return (
            <li key={app.slug} className="home-depth absolute" style={{ left: `${x}%`, top: `${y}%`, ["--depth" as string]: `${depth}px` }}>
              <span className="home-idle block opacity-80" style={{ ["--d" as string]: `${index * -700}ms` }}>
                <AnimatedIcon icon={app.icon} size={index % 3 === 0 ? 64 : 52} play="never" />
              </span>
            </li>
          );
        })}
      </ul>
      <div className={`${container} relative flex min-h-[78vh] flex-col items-center justify-center py-24 text-center sm:py-32`}>
        <div className="home-settle">
          {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
          <img src="/brand-kit/02-app-icons/anops-app-icon-ios-192x192.svg" alt="" width={72} height={72} className="mx-auto h-16 w-16 rounded-[22%] sm:h-[72px] sm:w-[72px]" />
          <h2 id="final-title" className="mx-auto mt-8 max-w-[16ch] font-[family-name:var(--font-heading)] text-[40px] font-semibold leading-[1.04] tracking-[-0.045em] text-[#F7F7F2] sm:text-[64px] lg:text-[80px]">
            Your whole business. One calm workspace.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#B4BFB7] sm:text-lg">
            Start free with one organization and one application. Bring in your team and the rest of the platform when you are ready.
          </p>
        </div>
        <div className="mt-10 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
          <Link href="/trial" className={`${btnPrimary} h-12 px-8 text-[15px]`}>
            Try it free
            <IconArrowRight size={14} />
          </Link>
          <Link href="/login" className="inline-flex h-12 min-h-[44px] items-center justify-center rounded-[var(--radius-control)] border border-[#5d7a6f] px-8 text-[15px] font-semibold text-[#F7F7F2] transition-colors hover:bg-[#192B27]">
            Sign in
          </Link>
        </div>
        <Link href="/pricing" className="group mt-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-[#F7F7F2]">
          Compare plans
          <IconArrowRight size={12} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </section>
  );
}
