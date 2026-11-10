"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { categoryInputSchema } from "@/features/inventory/schemas/inventory.schema";
import { createCategoryAction, setCategoryActiveAction, updateCategoryAction } from "@/features/inventory/actions/inventory.action";
import { Check, FolderTree, LoaderCircle, Pencil, Plus, Archive, ArchiveRestore } from "lucide-react";
import { ExpandableSection } from "@/shared/components/ui/expandable-section";
import { EmptyState } from "@/shared/components/data-display/empty-state";
import { ClientPagination } from "@/shared/components/data-display/client-pagination";
import { Button } from "@/shared/components/ui/button";
import { Field, FormActions, Textarea } from "@/shared/components/ui/form-kit";
import { FormMessage } from "@/shared/components/ui/form-message";
import { TextField } from "@/shared/components/ui/text-field";
import { StatusBadge } from "@/shared/components/data-display/status-badge";
import type { CategoryDto } from "@/features/inventory/types";

type CategoryFormValues = z.input<typeof categoryInputSchema>;

function CategoryForm({
  defaultValues,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  defaultValues: CategoryFormValues;
  submitLabel: string;
  onSubmit: (values: CategoryFormValues) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { register, handleSubmit, setError, formState: { errors } } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryInputSchema),
    mode: "onBlur",
    defaultValues,
  });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) =>
        startTransition(async () => {
          setFormError(null);
          const error = await onSubmit(values);
          if (error) {
            setFormError(error);
            if (error.includes("name")) setError("name", { message: error });
          }
        })
      )}
      className="grid gap-5"
    >
      <TextField label="Name" required placeholder="e.g. Raw materials" maxLength={80} error={errors.name?.message} {...register("name")} />
      <Field label="Description" htmlFor="category-description" hint="Optional. Shown to help your team choose the right category." error={errors.description?.message}>
        <Textarea
          id="category-description"
          rows={3}
          maxLength={300}
          placeholder="e.g. Components and ingredients used in production"
          aria-invalid={Boolean(errors.description)}
          {...register("description")}
        />
      </Field>
      {formError && <div><FormMessage kind="error">{formError}</FormMessage></div>}
      <div>
        <FormActions>
          {onCancel && <Button onClick={onCancel} disabled={pending}>Cancel</Button>}
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
            {pending ? "Saving…" : submitLabel}
          </Button>
        </FormActions>
      </div>
    </form>
  );
}

const PAGE_SIZE = 10;

export function CategoryManager({ categories, canManage }: { categories: CategoryDto[]; canManage: boolean }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(categories.length === 0);
  const [formKey, setFormKey] = useState(0);
  const [page, setPage] = useState(1);
  const pageItems = categories.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const refresh = () => router.refresh();

  return (
    <div className="space-y-6">
      {canManage && (
        <ExpandableSection title="New category" description="Group products for reporting and filtering. Optional." icon={Plus} open={formOpen} onOpenChange={setFormOpen}>
          <CategoryForm
            key={formKey}
            defaultValues={{ name: "", description: "" }}
            submitLabel="Add category"
            onCancel={() => setFormOpen(false)}
            onSubmit={async (values) => {
              const result = await createCategoryAction(values);
              if (!result.ok) return result.error.message;
              setNotice("Category added.");
              setFormOpen(false);
              setFormKey((k) => k + 1);
              refresh();
              return null;
            }}
          />
        </ExpandableSection>
      )}

      {notice && <FormMessage kind="success">{notice}</FormMessage>}

      {categories.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No categories yet"
          description="Categories group products for reporting and filtering. They are optional."
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-card)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)]">
          {pageItems.map((category) => (
            <li key={category.id} className="p-4">
              {editingId === category.id ? (
                <CategoryForm
                  defaultValues={{ name: category.name, description: category.description }}
                  submitLabel="Save"
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (values) => {
                    const result = await updateCategoryAction(category.id, values);
                    if (!result.ok) return result.error.message;
                    setEditingId(null);
                    refresh();
                    return null;
                  }}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--color-text-primary)]">
                      {category.name}
                      {!category.isActive && <StatusBadge label="Archived" tone="neutral" />}
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {category.description || "No description"} · {category.productCount} active product{category.productCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setEditingId(category.id)}><Pencil aria-hidden className="size-4" />Edit</Button>
                      <Button
                        onClick={async () => {
                          const result = await setCategoryActiveAction(category.id, !category.isActive);
                          if (!result.ok) return setNotice(result.error.message);
                          refresh();
                        }}
                      >
                        {category.isActive ? <Archive aria-hidden className="size-4" /> : <ArchiveRestore aria-hidden className="size-4" />}
                        {category.isActive ? "Archive" : "Restore"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <ClientPagination page={page} pageSize={PAGE_SIZE} total={categories.length} onPageChange={setPage} />
    </div>
  );
}
