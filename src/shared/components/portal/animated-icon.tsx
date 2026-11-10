import { cn } from "@/shared/lib/utils";

type AnimatedIconProps = {
  /** File name inside /public/animated (e.g. "wired-lineal-108-box-hover-squeeze.webp"). */
  icon: string;
  size?: number;
  /**
   * "hover": static poster, animates while the closest `.group` ancestor is hovered or keyboard-focused.
   * "always": animates continuously (use for one featured icon per view at most).
   * "never": poster only.
   */
  play?: "hover" | "always" | "never";
  className?: string;
  tile?: boolean;
};

const posterOf = (icon: string) => `/animated/posters/${icon.replace(/\.(webp|gif)$/, "")}.webp`;

/**
 * Lordicon animations are 256px, ~100 frames and up to 1 MB each, so the animated file is only
 * requested when it becomes visible (hover/focus), and never for reduced-motion users.
 */
export function AnimatedIcon({ icon, size = 48, play = "hover", className, tile = true }: AnimatedIconProps) {
  const img = "absolute inset-0 h-full w-full object-contain";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        tile && "rounded-[14px] border border-black/5 bg-[#F7F7F2] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
        className
      )}
      style={{ width: size, height: size }}
    >
      <span className="relative" style={{ width: tile ? size * 0.78 : size, height: tile ? size * 0.78 : size }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- static, pre-sized asset */}
        <img
          src={posterOf(icon)}
          alt=""
          width={128}
          height={128}
          decoding="async"
          loading="lazy"
          className={img}
        />
        {play !== "never" && (
          // eslint-disable-next-line @next/next/no-img-element -- animated WebP, next/image would drop the animation
          <img
            src={`/animated/${icon}`}
            alt=""
            width={256}
            height={256}
            decoding="async"
            loading={play === "always" ? "eager" : "lazy"}
            className={cn(
              img,
              // Opaque tile colour: the animation covers the poster once loaded, and the poster shows while it loads.
              tile && "bg-[#F7F7F2]",
              "hidden",
              play === "always" ? "motion-safe:block" : "motion-safe:group-hover:block motion-safe:group-focus-visible:block"
            )}
          />
        )}
      </span>
    </span>
  );
}
