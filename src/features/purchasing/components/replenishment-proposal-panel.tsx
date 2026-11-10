"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { convertReplenishmentAction, reconcileReplenishmentAction } from "@/features/purchasing/actions/purchasing.action";
import type { ReplenishmentProposalDto } from "@/server/purchasing/replenishment.service";
import { FilePlus2, Sparkles, Calculator } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Select } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";

type Message = { kind: "error" | "success"; text: string; href?: string };

const RATIONALE_NOTES: Record<ReplenishmentProposalDto["rationaleStatus"], string> = {
  generated: "AI explanations were checked against the stored facts for every product. The quantities are calculated by the system, not by the AI.",
  partial: "Some AI explanations were missing or rejected because they did not match the stored facts. Each product shows its calculation, and AI text appears only where it passed the checks.",
  unavailable: "AI explanations are unavailable right now. The calculation shown for each product is complete without them.",
  invalid_output: "The AI response could not be used, so no AI explanation is shown. The calculation for each product is complete.",
};

/**
 * One proposal: calculation basis, suggested lines, and the convert and recovery actions.
 * Every action re-checks state and permission on the server. The UI only shows what the server allows.
 */
export function ReplenishmentProposalPanel({
  proposal,
  suppliers,
  canConvert,
}: {
  proposal: ReplenishmentProposalDto;
  suppliers: { id: string; name: string }[];
  canConvert: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  function convert() {
    if (pending || !supplierId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await convertReplenishmentAction(proposal.id, { supplierId, expectedVersion: proposal.version });
      setConfirming(false);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        if (result.error.code === "CONFLICT") router.refresh();
        return;
      }
      setMessage({
        kind: "success",
        text: `Draft order ${result.data.orderNumber} was created. No stock changed. Review and approve it before goods are received.`,
        href: `/purchasing/orders/${result.data.id}`,
      });
      router.refresh();
    });
  }

  function reconcile() {
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await reconcileReplenishmentAction(proposal.id);
      if (!result.ok) {
        setMessage({ kind: "error", text: `${result.error.message} (ref ${result.error.requestId.slice(0, 8)})` });
        return;
      }
      setMessage({
        kind: "success",
        text: result.data.status === "converted"
          ? "The interrupted conversion was completed and linked to its order."
          : "The stale claim was released. You can review and convert the proposal again.",
      });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="proposal-heading" className="space-y-5">
      <div className="space-y-2">
        <h2 id="proposal-heading" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          Proposal for {proposal.warehouseCode}
          <span className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-[var(--color-status-warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--color-status-warning)]">
            <Sparkles aria-hidden className="size-3" />
            Recommendation, not applied
          </span>
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Generated {new Date(proposal.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC · covers {proposal.horizonDays} days ·
          {" "}history: last {proposal.lookbackDays} days
        </p>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4 text-sm space-y-2">
          <p className="flex items-center gap-2 font-semibold"><Calculator aria-hidden className="size-4" />How the suggested quantity is calculated</p>
          <p className="text-[var(--color-text-secondary)]">
            Daily use is the average of issues, transfers out and production consumption over the last {proposal.lookbackDays} days.
            Suggested = daily use × {proposal.horizonDays} days + reorder point − on hand, rounded up to whole units for countable items.
          </p>
          <p className="text-[var(--color-text-secondary)]">
            This is a trailing average, not a statistically validated forecast. It does not account for seasonality, lead times, or
            planned orders. Products with no recorded consumption are suggested only to restore their reorder point.
          </p>
          {proposal.truncated && (
            <p role="note" className="text-[var(--color-status-warning)]">
              The catalogue has more candidate products than one proposal evaluates. Only the first set was considered.
            </p>
          )}
          <p className="text-[var(--color-text-secondary)]">{RATIONALE_NOTES[proposal.rationaleStatus]}</p>
        </div>
      </div>

      {proposal.lines.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-control)] bg-[var(--color-bg-surface)] p-6 text-center text-sm text-[var(--color-text-secondary)]">No product needs replenishment for this horizon. Try a longer period to see more suggestions.</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          <table className="w-full min-w-[620px] text-left text-sm">
            <caption className="sr-only">Suggested purchase quantities by product</caption>
            <thead className="text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
              <tr>
                <th scope="col" className="px-4 py-3 font-semibold">Product</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">On hand</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Reorder point</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Used (period)</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Daily use</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Suggested</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {proposal.lines.map((line) => (
                <Fragment key={line.productId}>
                  <tr>
                    <td className="px-4 pt-3 pb-1">
                      <span className="font-medium">{line.sku}</span>
                      <span className="block text-xs text-[var(--color-text-secondary)]">{line.productName}</span>
                    </td>
                    <td className="px-4 pt-3 pb-1 text-right tabular-nums">{line.onHand} {line.unitOfMeasure}</td>
                    <td className="px-4 pt-3 pb-1 text-right tabular-nums">{line.reorderPoint}</td>
                    <td className="px-4 pt-3 pb-1 text-right tabular-nums">
                      {Number(line.consumedLookback) > 0 ? line.consumedLookback : <span className="text-[var(--color-text-secondary)]">None recorded</span>}
                    </td>
                    <td className="px-4 pt-3 pb-1 text-right tabular-nums">{line.forecastDailyUsage}</td>
                    <td className="px-4 pt-3 pb-1 text-right font-semibold tabular-nums">{line.suggested} {line.unitOfMeasure}</td>
                  </tr>
                  <tr>
                    <td colSpan={6} className="px-4 pt-0 pb-3 text-sm text-[var(--color-text-secondary)] space-y-2">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide">Calculation</p>
                        <ul className="list-disc space-y-0.5 pl-5">
                          {line.calculation.map((statement) => (
                            <li key={statement}>{statement}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide"><Sparkles aria-hidden className="size-3" />AI explanation (generated, verified against stored facts)</p>
                        <p>{line.rationale ?? "Not available for this product. The calculation above is complete."}</p>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proposal.status === "proposed" && canConvert && proposal.lines.length > 0 && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-4">
          <h3 className="text-base font-semibold">Create a draft purchase order</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Unit costs come from the product catalogue. The draft changes no stock and still needs approval.
          </p>
          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm">
                Create a draft order for <strong>{selectedSupplier?.name ?? "the selected supplier"}</strong> with {proposal.lines.length} lines?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={convert} disabled={pending || !supplierId}>
                  {pending ? "Creating draft…" : "Confirm and create draft"}
                </Button>
                <Button onClick={() => setConfirming(false)} disabled={pending}>Back</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <label htmlFor="supplierId" className="text-sm font-semibold">Supplier</label>
                <Select id="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={pending}>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
              <Button variant="primary" onClick={() => setConfirming(true)} disabled={pending || !supplierId}>
                <FilePlus2 aria-hidden className="size-4" />
                Create draft order…
              </Button>
            </div>
          )}
          {suppliers.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">Add an active supplier before creating an order.</p>}
        </div>
      )}

      {proposal.status === "proposed" && !canConvert && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          You can review this proposal. Creating an order needs order approval permission.
        </p>
      )}

      {proposal.status === "converting" && (
        <div className="space-y-3 rounded-[var(--radius-card)] border border-[var(--color-status-warning)] p-4">
          <p className="text-sm">
            A conversion of this proposal was interrupted. Recovery links the order that was created, or releases the claim if none exists.
            It never creates a second order.
          </p>
          {canConvert && (
            <Button onClick={reconcile} disabled={pending}>{pending ? "Checking…" : "Check and recover"}</Button>
          )}
        </div>
      )}

      {proposal.status === "converted" && proposal.convertedOrderId && !message && (
        <p className="text-sm">
          Converted to a draft order.{" "}
          <Link className="underline" href={`/purchasing/orders/${proposal.convertedOrderId}`}>View the order</Link>
        </p>
      )}

      {message && (
        <FormMessage kind={message.kind}>
          {message.text}{" "}
          {message.href && <Link className="font-semibold underline" href={message.href}>Open the order</Link>}
        </FormMessage>
      )}
    </section>
  );
}
