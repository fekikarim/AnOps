"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { customerCreateSchema, customerUpdateSchema } from "@/features/finance/schemas/finance.schema";
import {
  createCustomerAction,
  updateCustomerAction,
  deleteCustomerAction,
} from "@/features/finance/actions/finance.actions";
import { Button, textareaClass } from "@/shared/components/ui/button";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import { IconUsers, IconReceipt } from "@/shared/components/ui/brand-icons";
import type { Customer } from "@/features/finance/types";
import type { CustomerInsight } from "@/features/finance/utils/insights";

type CustomerFormData = {
  name: string;
  email: string;
  phone: string;
  taxId: string;
  address: string;
  notes: string;
  status: "active" | "inactive";
};

function CustomerForm({
  initial,
  isEdit = false,
  onSubmit,
  onCancel,
}: {
  initial?: Customer;
  isEdit?: boolean;
  onSubmit: (values: CustomerFormData) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerFormData>({
    // The two schemas take the same fields; the cast only bridges their preprocessed input types.
    resolver: zodResolver(isEdit ? customerUpdateSchema : customerCreateSchema) as unknown as Resolver<CustomerFormData>,
    mode: "onChange",
    defaultValues: {
      name: initial?.name || "",
      email: initial?.email || "",
      phone: initial?.phone || "",
      taxId: initial?.taxId || "",
      address: initial?.address || "",
      notes: initial?.notes || "",
      status: initial?.status || "active",
    },
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit(
        (values) =>
          startTransition(async () => {
            setFormError(null);
            const err = await onSubmit(values);
            if (err) setFormError(err);
          }),
        (validationErrors) => {
          console.warn("[CustomerForm] Validation failed:", validationErrors);
          const firstErr = Object.values(validationErrors)[0];
          if (firstErr && typeof firstErr === "object" && "message" in firstErr) {
            setFormError(String(firstErr.message));
          } else {
            setFormError("Please fill out all required fields properly.");
          }
        }
      )}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Customer / Business Name *"
          placeholder="e.g. Acme Corp or Mohamed Trabelsi"
          error={errors.name?.message}
          {...register("name")}
        />
        <TextField
          label="Tax ID (Matricule Fiscale)"
          placeholder="e.g. 1234567/A/M/000"
          error={errors.taxId?.message}
          {...register("taxId")}
        />
        <TextField
          label="Email Address"
          type="email"
          placeholder="billing@customer.com"
          error={errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Phone Number"
          type="tel"
          placeholder="+216 71 000 000"
          error={errors.phone?.message}
          {...register("phone")}
        />
        <div className="sm:col-span-2">
          <TextField
            label="Billing Address"
            placeholder="Street address, City, Postal code, Country"
            error={errors.address?.message}
            {...register("address")}
          />
        </div>
        <div className="sm:col-span-2 space-y-1">
          <label htmlFor="customer-notes" className="text-sm font-medium text-[var(--color-text-secondary)]">Notes (Optional)</label>
          <textarea id="customer-notes"
            rows={2}
            className={textareaClass}
            placeholder="Payment terms, special discounts, billing contact notes..."
            {...register("notes")}
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <label className="inline-flex min-h-[44px] items-center gap-3 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded-[calc(var(--radius-control)*0.5)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] accent-[var(--color-action-primary)] focus:outline-none"
              defaultChecked={(initial?.status ?? "active") === "active"}
              {...register("status")}
            />
            <span className="text-[var(--color-text-primary)] font-medium">Active Customer</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              (Inactive customers cannot be selected on new invoices)
            </span>
          </label>
        </div>
      </div>

      {formError && <FormMessage kind="error">{formError}</FormMessage>}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pt-2 border-t border-[var(--color-border-subtle)]">
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving..." : isEdit ? "Update Customer" : "Create Customer"}
        </Button>
      </div>
    </form>
  );
}

const RISK_STYLE: Record<CustomerInsight["risk"], { label: string; className: string }> = {
  low: { label: "Reliable payer", className: "bg-[var(--color-status-success-bg)] text-[var(--color-status-success)]" },
  medium: { label: "Watch", className: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning)]" },
  high: { label: "Payment risk", className: "bg-[var(--color-status-error-bg)] text-[var(--color-status-error)]" },
  new: { label: "No payment history", className: "bg-[var(--color-bg-subtle)] text-[var(--color-text-secondary)]" },
};

export function CustomerManager({
  customers,
  canManage,
  insights = {},
}: {
  customers: Customer[];
  canManage: boolean;
  /** Payment behaviour per customer id, computed from their invoices (see utils/insights). */
  insights?: Record<string, CustomerInsight>;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"list" | "create" | { edit: Customer }>("list");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filtered = customers.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q)) ||
      (c.taxId && c.taxId.toLowerCase().includes(q)) ||
      (c.phone && c.phone.toLowerCase().includes(q))
    );
  });

  const activeCount = customers.filter((c) => c.status === "active").length;
  const inactiveCount = customers.length - activeCount;

  async function handleCreate(values: CustomerFormData): Promise<string | null> {
    const res = await createCustomerAction(values);
    if (res.error) return res.error;
    setMessage({ type: "success", text: "Customer created successfully." });
    setMode("list");
    router.refresh();
    return null;
  }

  async function handleUpdate(id: string, values: CustomerFormData): Promise<string | null> {
    const res = await updateCustomerAction(id, values);
    if (res.error) return res.error;
    setMessage({ type: "success", text: "Customer updated successfully." });
    setMode("list");
    router.refresh();
    return null;
  }

  async function handleDelete(customer: Customer) {
    setConfirmDeleteId(null);
    setPendingDeleteId(customer.id);
    setMessage(null);
    const res = await deleteCustomerAction(customer.id);
    setPendingDeleteId(null);
    if (res.error) {
      setMessage({ type: "error", text: res.error });
      return;
    }
    const notice = res.data?.message || "Customer removed successfully.";
    setMessage({ type: "success", text: notice });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Top Banner Stats */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Total Customers
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-text-primary)]">
            {customers.length}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Active Accounts
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-status-success)]">
            {activeCount}
          </div>
        </div>
        <div className="p-4 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-control)]">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
            Inactive
          </div>
          <div className="mt-1 text-2xl font-semibold text-[var(--color-text-secondary)]">
            {inactiveCount}
          </div>
        </div>
      </div>

      {/* Notification Message */}
      {message && (
        <FormMessage kind={message.type === "success" ? "success" : "error"}>
          {message.text}
        </FormMessage>
      )}

      {/* Create / Edit Form Card */}
      {canManage && mode === "create" && (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border-subtle)]">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <IconUsers size={18} className="text-[var(--color-action-primary)]" />
              New Customer Account
            </h2>
            <button
              onClick={() => setMode("list")}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Close
            </button>
          </div>
          <CustomerForm onSubmit={handleCreate} onCancel={() => setMode("list")} />
        </section>
      )}

      {canManage && typeof mode === "object" && "edit" in mode && (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-[var(--color-border-subtle)]">
            <h2 className="text-base font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <IconUsers size={18} className="text-[var(--color-action-primary)]" />
              Edit Customer: {mode.edit.name}
            </h2>
            <button
              onClick={() => setMode("list")}
              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              Close
            </button>
          </div>
          <CustomerForm
            initial={mode.edit}
            isEdit
            onSubmit={(vals) => handleUpdate(mode.edit.id, vals)}
            onCancel={() => setMode("list")}
          />
        </section>
      )}

      {/* Control Bar: Search & New Customer Button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, phone or Tax ID..."
            className="w-full min-h-[44px] rounded-[var(--radius-control)] border border-[var(--color-border-control)] bg-[var(--color-bg-surface)] px-3 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--color-focus-ring)]"
          />
        </div>
        {canManage && mode === "list" && (
          <Button variant="primary" onClick={() => setMode("create")}>
            + Add New Customer
          </Button>
        )}
      </div>

      {/* Customers Table */}
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-bg-subtle)]/50 text-[var(--color-text-secondary)] font-medium">
                <th className="py-3 px-4">Customer Name</th>
                <th className="py-3 px-4">Tax ID / Matricule</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border-subtle)]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--color-text-secondary)]">
                    {search ? (
                      <div>No customers matched &quot;{search}&quot;.</div>
                    ) : (
                      <div className="space-y-3">
                        <IconUsers size={32} className="mx-auto text-[var(--color-text-secondary)] opacity-50" />
                        <div className="font-medium text-[var(--color-text-primary)]">No customers registered yet</div>
                        <p className="text-xs">Add your first customer to start generating invoices and tracking receivables.</p>
                        {canManage && (
                          <Button variant="primary" onClick={() => setMode("create")}>
                            Create First Customer
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--color-bg-subtle)]/40 transition-colors">
                    <td className="py-3 px-4 font-medium text-[var(--color-text-primary)]">
                      <div>{c.name}</div>
                      {insights[c.id] && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-normal">
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${RISK_STYLE[insights[c.id].risk].className}`}>{RISK_STYLE[insights[c.id].risk].label}</span>
                          <span className="text-[var(--color-text-secondary)]">{insights[c.id].summary}</span>
                          {insights[c.id].openBalance.map((b) => (
                            <span key={b.currency} className="text-[var(--color-text-secondary)]">· owes {b.amount.toFixed(2)} {b.currency}</span>
                          ))}
                        </div>
                      )}
                      {c.address && (
                        <div className="text-xs text-[var(--color-text-secondary)] truncate max-w-xs">
                          {c.address}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-primary)]">
                      {c.taxId ? (
                        <span className="font-mono text-xs bg-[var(--color-bg-subtle)] px-2 py-0.5 rounded border border-[var(--color-border-subtle)]">
                          {c.taxId}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-secondary)] text-xs">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[var(--color-text-primary)]">
                      <div className="space-y-0.5 text-xs">
                        {c.email && (
                          <div>
                            <a
                              href={`mailto:${c.email}`}
                              className="text-[var(--color-action-primary)] hover:underline"
                            >
                              {c.email}
                            </a>
                          </div>
                        )}
                        {c.phone && <div className="text-[var(--color-text-secondary)]">{c.phone}</div>}
                        {!c.email && !c.phone && <span className="text-[var(--color-text-secondary)]">—</span>}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge
                        label={c.status === "active" ? "Active" : "Inactive"}
                        tone={c.status === "active" ? "success" : "neutral"}
                      />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/finance/invoices/new?customerId=${c.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--color-action-primary)] hover:underline font-medium px-2 py-1 rounded hover:bg-[var(--color-action-primary)]/10"
                          title="Create invoice for this customer"
                        >
                          <IconReceipt size={14} />
                          Invoice
                        </Link>
                        {canManage && (
                          <>
                            <button
                              onClick={() => setMode({ edit: c })}
                              className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] px-2 py-1 rounded hover:bg-[var(--color-bg-subtle)] font-medium"
                            >
                              Edit
                            </button>
                            {confirmDeleteId === c.id ? (
                              <>
                                <button
                                  onClick={() => handleDelete(c)}
                                  disabled={pendingDeleteId === c.id}
                                  title="Customers with invoices are deactivated instead of deleted"
                                  className="text-xs font-semibold px-2 py-1 rounded bg-[var(--color-status-error-bg)] text-[var(--color-status-error)] hover:opacity-80 disabled:opacity-50"
                                >
                                  {pendingDeleteId === c.id ? "..." : "Confirm"}
                                </button>
                                <button onClick={() => setConfirmDeleteId(null)} className="text-xs font-medium px-2 py-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-subtle)]">
                                  Keep
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(c.id)}
                                disabled={pendingDeleteId === c.id}
                                className="text-xs text-[var(--color-status-error)] hover:opacity-80 px-2 py-1 rounded hover:bg-[var(--color-status-error-bg)] font-medium disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
