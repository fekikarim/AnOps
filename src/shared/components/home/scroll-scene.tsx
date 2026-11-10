"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * How progress (`--p`, 0..1) is measured while an element crosses the viewport.
 * - "pin":   0 when the element's top reaches the top, 1 when its bottom reaches the bottom (pinned scenes).
 * - "enter": 0 as the element's top enters at the bottom of the viewport, 1 once it is 75% up the screen.
 * - "exit":  0 at rest, 1 once the element has scrolled 60% of its height out of view (the hero).
 */
export type ProgressMode = "pin" | "enter" | "exit";

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Writes scroll progress to a CSS custom property on the element: no React re-render per frame,
 * transforms and opacity only. Listens to scroll only while the element is near the viewport.
 * Reduced-motion users get the final state (`--p: 1`).
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, mode: ProgressMode) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.style.setProperty("--p", "1");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      const vh = window.innerHeight;
      let progress: number;
      if (mode === "exit") progress = -rect.top / Math.max(1, rect.height * 0.6);
      else if (mode === "pin" && rect.height > vh * 1.2) progress = -rect.top / Math.max(1, rect.height - vh);
      // Not pinned (phones, short scenes): treat as an entrance.
      else progress = (vh - rect.top) / Math.max(1, vh * 0.75);
      element.style.setProperty("--p", clamp01(progress).toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    let listening = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !listening) {
          listening = true;
          window.addEventListener("scroll", onScroll, { passive: true });
          window.addEventListener("resize", onScroll);
          update();
        } else if (!entry.isIntersecting && listening) {
          listening = false;
          window.removeEventListener("scroll", onScroll);
          window.removeEventListener("resize", onScroll);
          update();
        }
      },
      { rootMargin: "25% 0px" }
    );
    observer.observe(element);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref, mode]);
}

/**
 * A scene that pins its content while the visitor scrolls through it (desktop/tablet, motion allowed),
 * and becomes a normal section with an entrance on phones and for reduced motion. No scroll hijacking:
 * the page always scrolls at the visitor's own pace.
 */
export function ScrollScene({
  children,
  length = "md",
  className,
  stickClassName,
  id,
  labelledBy,
  style,
}: {
  children: ReactNode;
  length?: "sm" | "md" | "lg";
  className?: string;
  stickClassName?: string;
  id?: string;
  labelledBy?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, "pin");
  return (
    <section ref={ref} id={id} aria-labelledby={labelledBy} data-len={length} className={cn("home-scene", className)} style={style}>
      <div className={cn("home-stick", stickClassName)}>{children}</div>
    </section>
  );
}

/** A plain block that exposes `--p` for its children (entrance or exit progress). */
export function ProgressBlock({ children, mode = "enter", className, as: Tag = "div", ...rest }: { children: ReactNode; mode?: ProgressMode; className?: string; as?: "div" | "section" } & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, mode);
  return (
    <Tag ref={ref as never} className={className} {...rest}>
      {children}
    </Tag>
  );
}
