"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, ShieldCheck, ShieldPlus, Ban, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EscalationBadge } from "@/components/escalation-badge";
import {
  cancelAndRefundGroup,
  clearAdminEscalation,
  securedPhase,
  setGroupStatus,
  subscribeLedger,
  takeOverAsCaretaker,
  transferOwnershipToManager,
  type Group,
  type LedgerEntry,
  type LedgerKind,
} from "@/lib/groups";
import { Badge } from "@/components/ui/badge";

const PHASE_LABELS: Record<string, string> = {
  notStarted: "Not started",
  collateral: "Collateral (Phase 1)",
  distribution: "Distribution (Phase 2)",
  closed: "Closed",
};

function fmtCurrency(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString()}`;
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function GroupDetailSheet({
  group,
  onOpenChange,
}: {
  group: Group | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState<
    "promote" | "status" | "clear" | "caretaker" | "cancel" | null
  >(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);

  useEffect(() => {
    if (!group) {
      setLedger(null);
      return;
    }
    const unsub = subscribeLedger(group.id, setLedger, 25, () => setLedger([]));
    return unsub;
  }, [group?.id]);

  if (!group) return null;

  const isActive = group.status === "active";
  const phase = securedPhase(group);
  const flag = group.adminEscalationFlag;
  const isCaretaker = group.caretakerBy !== null;
  const showCaretakerAction = flag === "admin_default" || flag === "both_default";
  const showCancelAction = flag !== null;

  async function run(
    kind: "promote" | "status" | "clear" | "caretaker" | "cancel",
    fn: () => Promise<void>,
    ok: string,
  ) {
    setBusy(kind);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!group} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {group.name}
            {group.adminEscalationFlag && <EscalationBadge flag={group.adminEscalationFlag} />}
            {isCaretaker && (
              <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                <ShieldPlus className="h-3 w-3" /> Caretaker admin
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {group.type === "secured" ? "Secured tontine" : "Traditional tontine"} — {group.description || "no description"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Status" value={isActive ? "Active" : "Inactive"} />
            <Field label="Members" value={String(group.memberCount)} />
            <Field label="Contribution" value={fmtCurrency(group.amount, group.currency)} />
            <Field label="Frequency" value={group.frequency} />
            {group.type === "secured" && (
              <>
                <Field label="Phase" value={PHASE_LABELS[phase] ?? phase} />
                <Field
                  label="Cycle"
                  value={group.currentCycle ? `${group.currentCycle} / ${group.memberCount}` : "—"}
                />
              </>
            )}
            <Field label="Created" value={fmtDate(group.createdAt)} />
            <Field label="Admin uid" value={group.createdBy} mono />
          </div>

          {group.adminEscalationFlag && (
            <>
              <Separator />
              <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
                <div className="font-medium text-red-800 dark:text-red-200">Escalation raised</div>
                <div className="text-red-700 dark:text-red-300">
                  {group.adminEscalationReason ?? "No reason recorded."}
                </div>
                <div className="text-xs text-red-600/80 dark:text-red-400/80">
                  Flagged {fmtDate(group.adminEscalationFlaggedAt)}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Super-admin actions
            </div>
            {flag === "admin_default" && (
              <Button
                variant="default"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "promote",
                    () => transferOwnershipToManager(group.id),
                    "Manager promoted to admin.",
                  )
                }
              >
                <ShieldCheck /> Promote manager to admin
              </Button>
            )}
            {showCaretakerAction && !isCaretaker && (
              <Button
                variant="default"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "caretaker",
                    () => takeOverAsCaretaker(group.id),
                    "You are now the caretaker admin.",
                  )
                }
              >
                <ShieldPlus /> Take over as caretaker admin
              </Button>
            )}
            {showCancelAction && (
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "cancel",
                    () => cancelAndRefundGroup(group.id),
                    "Group cancelled and members refunded.",
                  )
                }
              >
                <Ban /> Cancel + refund all members
              </Button>
            )}
            {flag && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("clear", () => clearAdminEscalation(group.id), "Escalation flag cleared.")
                }
              >
                <X /> Dismiss escalation (false positive)
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "status",
                  () => setGroupStatus(group.id, isActive ? "inactive" : "active"),
                  isActive ? "Group deactivated." : "Group reactivated.",
                )
              }
            >
              {isActive ? <PauseCircle /> : <PlayCircle />}
              {isActive ? "Deactivate group" : "Reactivate group"}
            </Button>
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recent ledger
            </div>
            <LedgerList entries={ledger} currency={group.currency} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const LEDGER_STYLES: Record<LedgerKind, string> = {
  contribution:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  payout:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  refund:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  penalty:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

function LedgerList({
  entries,
  currency,
}: {
  entries: LedgerEntry[] | null;
  currency: string;
}) {
  if (entries === null) {
    return <div className="text-xs text-muted-foreground">Loading ledger…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No entries yet — the ledger fills as contributions, payouts, and refunds happen.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((e) => (
        <div
          key={e.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2"
        >
          <div className="flex flex-1 flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={LEDGER_STYLES[e.kind]}>
                {e.kind}
              </Badge>
              <span className="text-xs text-muted-foreground">cycle {e.cycleNumber}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground" title={e.userId}>
              {e.userId}
            </div>
            {e.note && (
              <div className="truncate text-xs italic text-muted-foreground/80" title={e.note}>
                {e.note}
              </div>
            )}
          </div>
          <div className="tabular-nums text-sm font-medium">
            {currency} {e.amount.toLocaleString()}
          </div>
        </div>
      ))}
    </div>
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
