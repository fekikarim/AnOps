import type { Metadata } from "next";
import { getFinanceService } from "@/server/services/finance.service";
import { CustomerManager } from "@/features/finance/components/customer-manager";
import type { FinanceService } from "@/server/services/finance.service";

export const metadata: Metadata = {
  title: "Customers | Finance | AnOps ERP",
  description: "Manage client accounts, billing information, and tax identifiers.",
};

export default async function FinanceCustomersPage() {
  let customers: Awaited<ReturnType<FinanceService["listCustomers"]>> = [];
  let canManage = false;
  let insights = {};

  try {
    const service = await getFinanceService();
    [customers, insights] = await Promise.all([service.listCustomers(), service.getCustomerInsights()]);
    canManage = service.hasPermission("finance.customer.manage");
  } catch {
    customers = [];
    canManage = false;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
          Customer Accounts
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Directory of business clients and accounts for invoicing and receivables
        </p>
      </div>

      <CustomerManager customers={customers} canManage={canManage} insights={insights} />
    </div>
  );
}
