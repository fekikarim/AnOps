import { DELIVERY_STATUSES, type DeliveryStatus } from "@/features/marketing/types/constants";

/** Accepts only known delivery statuses from the URL. Anything else falls back to "all". */
export function deliveryStatusFilter(raw: string | undefined): "all" | DeliveryStatus {
  return (DELIVERY_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as DeliveryStatus) : "all";
}
