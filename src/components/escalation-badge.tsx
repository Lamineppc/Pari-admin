import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AdminEscalationFlag } from "@/lib/groups";

const LABELS: Record<AdminEscalationFlag, string> = {
  admin_default: "Admin default",
  manager_default: "Manager default",
  both_default: "Both defaulted",
};

export function EscalationBadge({ flag }: { flag: AdminEscalationFlag }) {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      <AlertTriangle className="h-3 w-3" />
      {LABELS[flag]}
    </Badge>
  );
}
