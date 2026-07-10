"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ShieldOff, XCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StoreStatusBadge } from "./store-status-badge";
import { approveStore, rejectStore, revokeStore, type Store } from "@/lib/stores";

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function StoreDetailSheet({
  store,
  onOpenChange,
}: {
  store: Store | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | "revoke" | null>(null);

  useEffect(() => {
    setReason("");
  }, [store?.id]);

  if (!store) return null;

  async function run(kind: "approve" | "reject" | "revoke") {
    setBusy(kind);
    try {
      if (kind === "approve") {
        await approveStore(store!);
        toast.success("Store approved.");
      } else if (kind === "reject") {
        await rejectStore(store!, reason);
        toast.success("Store rejected.");
      } else {
        await revokeStore(store!, reason);
        toast.success("Store access revoked.");
      }
      setReason("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!store} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {store.storeName || "(no name)"}
            <StoreStatusBadge status={store.status} />
          </SheetTitle>
          <SheetDescription>{store.category}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Owner" value={store.ownerName || "—"} />
            <Field label="Owner uid" value={store.ownerId} mono />
            <Field label="Applied" value={fmtDate(store.createdAt)} />
          </div>

          {store.description && (
            <div>
              <div className="text-xs text-muted-foreground">Description</div>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                {store.description}
              </p>
            </div>
          )}

          {store.rejectionReason && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
              <div className="font-medium text-red-800 dark:text-red-200">Recorded reason</div>
              <div className="mt-1 text-red-700 dark:text-red-300">{store.rejectionReason}</div>
            </div>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Decision
            </div>

            {store.status === "pending" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Reason (only sent on rejection)</Label>
                  <Textarea
                    id="reason"
                    placeholder="Explain briefly if rejecting. Leaving this blank sends a generic message."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  variant="default"
                  disabled={busy !== null}
                  onClick={() => run("approve")}
                >
                  <CheckCircle2 /> Approve store
                </Button>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("reject")}
                >
                  <XCircle /> Reject application
                </Button>
              </>
            )}

            {store.status === "active" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Reason for revoking</Label>
                  <Textarea
                    id="reason"
                    placeholder="Optional. Explain briefly why access is being revoked."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => run("revoke")}
                >
                  <ShieldOff /> Revoke store access
                </Button>
              </>
            )}

            {(store.status === "rejected" || store.status === "revoked") && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Reason (only used if you re-decide)</Label>
                  <Textarea
                    id="reason"
                    placeholder="Optional."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  variant="default"
                  disabled={busy !== null}
                  onClick={() => run("approve")}
                >
                  <CheckCircle2 /> Reinstate store
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono text-xs" : "text-sm"} title={value}>
        {value}
      </span>
    </div>
  );
}
