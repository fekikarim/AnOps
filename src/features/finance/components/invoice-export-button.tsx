"use client";

import { useTransition } from "react";
import { useToast } from "@/shared/components/ui/toast";
import { exportInvoicesCsvAction } from "@/features/finance/actions/finance.actions";
import { Button } from "@/shared/components/ui/button";

export function InvoiceExportButton() {
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function handleExport() {
    startTransition(async () => {
      const res = await exportInvoicesCsvAction();
      if (res.error) {
        toast.error("Export failed", res.error);
        return;
      }
      if (res.data?.csv) {
        const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", res.data.filename || "invoices.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    });
  }

  return (
    <Button variant="secondary" onClick={handleExport} disabled={pending} className="text-xs">
      {pending ? "Exporting..." : "⬇ Export CSV"}
    </Button>
  );
}
