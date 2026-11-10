import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonClass } from "@/shared/components/ui/button";

/** Shared "back to list" control used in page headers. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={buttonClass("secondary")}>
      <ArrowLeft aria-hidden className="size-4" />
      {children}
    </Link>
  );
}
