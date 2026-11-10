import type { Metadata } from "next";
import { AppsDirectory } from "@/app/(marketing)/apps/apps-directory";
import { container } from "@/shared/components/marketing/styles";
import { AnimatedIcon } from "@/shared/components/portal/animated-icon";
import { CtaBand, PageHero } from "@/shared/components/portal/sections";
import { apps, categories, type CategoryId } from "@/shared/config/catalog";

export const metadata: Metadata = {
  title: "Apps",
  description:
    "The AnOps managements: AnOps AI, HR & Payroll, CRM, Sales, Finance, Inventory, Purchasing, Manufacturing, Marketing, and Blogs & Community.",
};

export default async function AppsPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const params = await searchParams;
  const initialCategory = categories.find((category) => category.id === params.category)?.id as CategoryId | undefined;
  const available = apps.filter((app) => app.status === "available").length;

  return (
    <>
      <PageHero
        eyebrow="Application directory"
        title="Every operation has its app. Every app shares the same records."
        lead={`${apps.length} managements cover your people, money, stock, suppliers, production, customers and community. Use one, or all of them together.`}
        aside={
          <div className="grid grid-cols-4 gap-3 sm:gap-4">
            {apps.map((app, index) => (
              <span key={app.slug} className="group flex justify-center" title={app.name}>
                <AnimatedIcon icon={app.icon} size={64} play={index === 0 ? "always" : "hover"} className="max-sm:h-14 max-sm:w-14" />
              </span>
            ))}
            <span className="flex flex-col items-center justify-center rounded-[14px] border border-dashed border-[var(--color-border-control)] text-center">
              <span className="font-[family-name:var(--font-heading)] text-xl font-semibold text-[var(--color-text-primary)]">{available}/{apps.length}</span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">available</span>
            </span>
          </div>
        }
      />
      <section className={`${container} py-10 sm:py-14`}>
        <AppsDirectory initialCategory={initialCategory} />
      </section>
      <CtaBand title="Pick one app to start. Add the rest when you need them." />
    </>
  );
}
