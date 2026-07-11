"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Floating bar that appears at the bottom of a page when any rows are
 *  selected. Callers pass the count and their own action buttons. */
export function BulkActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-lg border bg-popover px-4 py-2 text-popover-foreground shadow-lg">
        <Button variant="ghost" size="icon-sm" onClick={onClear}>
          <X />
        </Button>
        <span className="text-sm font-medium">
          {count} selected
        </span>
        <div className="flex items-center gap-2 border-l pl-3">{children}</div>
      </div>
    </div>
  );
}
