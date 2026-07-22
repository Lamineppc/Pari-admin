"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Pause, Play, ShieldOff, XCircle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StoreStatusBadge } from "./store-status-badge";
import {
  approveStore,
  computeMetrics,
  reinstateStore,
  rejectStore,
  revokeStore,
  setStoreEscalation,
  subscribeStoreListings,
  suspendStore,
  type Store,
  type StoreEscalationFlag,
  type StoreListing,
} from "@/lib/stores";

type Action = "approve" | "reject" | "suspend" | "reinstate" | "revoke";

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtRelative(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day) return "today";
  const days = Math.floor(diffMs / day);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function StoreDetailSheet({
  store,
  onOpenChange,
}: {
  store: Store | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [listings, setListings] = useState<StoreListing[] | null>(null);

  useEffect(() => {
    setReason("");
    setListings(null);
    if (!store) return;
    const unsub = subscribeStoreListings(
      store.ownerId,
      setListings,
      (e) => {
        toast.error(e.message);
        setListings([]);
      },
    );
    return unsub;
  }, [store?.id, store?.ownerId, store]);

  const metrics = useMemo(
    () => (listings ? computeMetrics(listings) : null),
    [listings],
  );

  if (!store) return null;

  async function run(kind: Action) {
    setBusy(kind);
    try {
      if (kind === "approve") {
        await approveStore(store!);
        toast.success("Store approved.");
      } else if (kind === "reject") {
        await rejectStore(store!, reason);
        toast.success("Store rejected.");
      } else if (kind === "suspend") {
        await suspendStore(store!, reason);
        toast.success("Store suspended.");
      } else if (kind === "reinstate") {
        await reinstateStore(store!);
        toast.success("Store reinstated.");
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
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
            <Field
              label="Approved"
              value={
                store.approvedAt
                  ? `${fmtDate(store.approvedAt)} (${fmtRelative(store.approvedAt)})`
                  : "—"
              }
            />
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

          {/* Metrics */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Metrics
            </div>
            {metrics === null ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="grid grid-cols-4 gap-2 text-center">
                <MetricCell label="Total" value={metrics.totalListings} />
                <MetricCell label="Active" value={metrics.activeListings} />
                <MetricCell label="Sold" value={metrics.soldListings} />
                <MetricCell label="Likes" value={metrics.totalLikes} />
              </div>
            )}
          </div>

          {/* Listings */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Store listings ({listings?.length ?? "—"})
            </div>
            {listings === null && <Skeleton className="h-16 w-full" />}
            {listings !== null && listings.length === 0 && (
              <p className="text-xs text-muted-foreground">
                This store has not published any listings yet.
              </p>
            )}
            {listings && listings.length > 0 && (
              <div className="max-h-72 overflow-y-auto rounded-md border">
                {listings.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-3 border-b p-2 last:border-b-0"
                  >
                    {l.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.imageUrl}
                        alt=""
                        className="h-10 w-10 rounded object-cover"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {l.title || "(no title)"}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{l.currency} {l.price.toLocaleString()}</span>
                        <span>·</span>
                        <span>{l.category}</span>
                        {l.likedByCount > 0 && (
                          <>
                            <span>·</span>
                            <span>♥ {l.likedByCount}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {l.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          <StoreEscalationPanel store={store} />

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
                  <Label htmlFor="reason">Reason (sent to owner on suspend/revoke)</Label>
                  <Textarea
                    id="reason"
                    placeholder="Optional. Explain briefly why the store is being paused or revoked."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => run("suspend")}
                >
                  <Pause /> Suspend store (reversible)
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => run("revoke")}
                >
                  <ShieldOff /> Revoke store access
                </Button>
              </>
            )}

            {store.status === "suspended" && (
              <>
                <Button
                  variant="default"
                  disabled={busy !== null}
                  onClick={() => run("reinstate")}
                >
                  <Play /> Reinstate store
                </Button>
                <div className="grid gap-2">
                  <Label htmlFor="reason">Reason (for permanent revoke)</Label>
                  <Textarea
                    id="reason"
                    placeholder="Optional."
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

function StoreEscalationPanel({ store }: { store: Store }) {
  const [flag, setFlag] = useState<StoreEscalationFlag | "">(
    store.escalationFlag ?? "",
  );
  const [reason, setReason] = useState(store.escalationReason ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFlag(store.escalationFlag ?? "");
    setReason(store.escalationReason ?? "");
  }, [store.escalationFlag, store.escalationReason]);

  async function apply() {
    setBusy(true);
    try {
      await setStoreEscalation(
        store,
        flag === "" ? null : (flag as StoreEscalationFlag),
        reason,
      );
      toast.success(
        flag === "" ? "Escalation cleared." : "Escalation flag applied.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearFlag() {
    setBusy(true);
    try {
      await setStoreEscalation(store, null);
      setFlag("");
      setReason("");
      toast.success("Escalation cleared.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Escalation
      </div>
      <p className="text-xs text-muted-foreground">
        Raise a flag when this store needs attention (spam listings, fraud
        suspected, complaint received). Does not restrict access — pair with
        suspend or revoke as needed.
      </p>
      {store.escalationFlaggedAt && (
        <p className="text-[11px] text-amber-700">
          Flagged {store.escalationFlaggedAt.toLocaleString()}
        </p>
      )}
      <div className="flex max-w-md flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <label className="w-20 text-xs text-muted-foreground">Kind</label>
          <select
            value={flag}
            onChange={(e) =>
              setFlag(e.target.value as StoreEscalationFlag | "")
            }
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="">— none —</option>
            <option value="spam_reports">spam_reports</option>
            <option value="fraud_suspected">fraud_suspected</option>
            <option value="complaint">complaint</option>
            <option value="other">other</option>
          </select>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-20 pt-1 text-xs text-muted-foreground">
            Reason
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Context — where this came from, what to check."
            className="flex-1 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="w-fit"
            disabled={busy || flag === ""}
            onClick={apply}
          >
            {busy ? "Saving…" : store.escalationFlag ? "Update flag" : "Raise flag"}{" "}
            <ChevronRight />
          </Button>
          {store.escalationFlag && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={clearFlag}
            >
              Clear flag <ChevronRight />
            </Button>
          )}
        </div>
      </div>
    </section>
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

function MetricCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
