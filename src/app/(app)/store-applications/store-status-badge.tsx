import { Badge } from "@/components/ui/badge";
import type { StoreStatus } from "@/lib/stores";

const STYLES: Record<StoreStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  active: {
    label: "Active",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  suspended: {
    label: "Suspended",
    className:
      "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  },
  rejected: {
    label: "Rejected",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
  revoked: {
    label: "Revoked",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  },
};

export function StoreStatusBadge({ status }: { status: StoreStatus }) {
  const { label, className } = STYLES[status];
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}
