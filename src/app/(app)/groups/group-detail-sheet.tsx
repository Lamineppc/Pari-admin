"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Beaker, FastForward, PauseCircle, PlayCircle, ShieldCheck, ShieldPlus, Ban, X, Wallet as WalletIcon } from "lucide-react";
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
  isMockMoneyGroup,
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
import {
  groupPotId,
  mockPaymentProvider,
  type Wallet,
} from "@/lib/money/mock/mock-payment-provider";
import {
  previewNextCycle,
  runNextCycle,
  type SimulatorPreview,
  type SimulatorRunResult,
} from "@/lib/simulator";

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
    "promote" | "status" | "clear" | "caretaker" | "cancel" | "simulate" | null
  >(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [pot, setPot] = useState<Wallet | null>(null);
  const [simPreview, setSimPreview] = useState<SimulatorPreview | null>(null);

  useEffect(() => {
    if (!group) {
      setLedger(null);
      return;
    }
    const unsub = subscribeLedger(group.id, setLedger, 25, () => setLedger([]));
    return unsub;
  }, [group?.id]);

  useEffect(() => {
    if (!group || !isMockMoneyGroup(group)) {
      setPot(null);
      return;
    }
    const unsub = mockPaymentProvider.subscribeWallet(groupPotId(group.id), setPot);
    return unsub;
  }, [group?.id, group ? isMockMoneyGroup(group) : false]);

  useEffect(() => {
    if (!group || !isMockMoneyGroup(group) || group.type !== "secured") {
      setSimPreview(null);
      return;
    }
    let cancelled = false;
    previewNextCycle(group.id).then((p) => {
      if (!cancelled) setSimPreview(p);
    });
    return () => {
      cancelled = true;
    };
  }, [
    group?.id,
    group?.currentCycle,
    group?.memberCount,
    group?.status,
    group?.type,
    group ? isMockMoneyGroup(group) : false,
  ]);

  if (!group) return null;

  const isActive = group.status === "active";
  const phase = securedPhase(group);
  const flag = group.adminEscalationFlag;
  const isCaretaker = group.caretakerBy !== null;
  const showCaretakerAction = flag === "admin_default" || flag === "both_default";
  const showCancelAction = flag !== null;
  const isMock = isMockMoneyGroup(group);

  async function runSimulate() {
    if (!group) return;
    setBusy("simulate");
    try {
      const result: SimulatorRunResult = await runNextCycle(group.id);
      const parts: string[] = [];
      if (result.contributions > 0) parts.push(`${result.contributions} contribution(s)`);
      if (result.firstHalfPayouts > 0) parts.push(`${result.firstHalfPayouts} first-half payout(s)`);
      if (result.secondHalfPayouts > 0) parts.push(`${result.secondHalfPayouts} second-half payout(s)`);
      if (result.leftover) {
        parts.push(
          `leftover split ${group.currency} ${(result.leftover.adminShare * 2).toLocaleString()}`,
        );
      }
      toast.success(
        `Cycle ${result.cycleRan} (${result.phase}): ${parts.join(", ") || "no writes"}${result.markedCompleted ? " · rotation completed" : ""}`,
      );
      const next = await previewNextCycle(group.id);
      setSimPreview(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

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
            {isMock && (
              <span className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                <Beaker className="h-3 w-3" /> Simulation
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {group.type === "secured" ? "Secured tontine" : "Traditional tontine"} — {group.description || "no description"}
          </SheetDescription>
        </SheetHeader>

        {isMock && (
          <div className="mx-4 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
            <span className="font-semibold">Simulation — no real money.</span> All
            balances are mock. See docs/mock_money.md for details.
          </div>
        )}

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

          {isMock && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Mock pot
                </div>
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <WalletIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Balance</span>
                  </div>
                  <div className="tabular-nums text-lg font-semibold">
                    {pot ? `${pot.currency} ${pot.balance.toLocaleString()}` : "…"}
                  </div>
                </div>
              </div>
            </>
          )}

          {isMock && group.type === "secured" && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Secured simulator
                </div>
                <SimulatorPanel
                  preview={simPreview}
                  busy={busy === "simulate"}
                  onRun={runSimulate}
                  currency={group.currency}
                  amount={group.amount}
                  memberCount={group.memberCount}
                />
              </div>
            </>
          )}

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

function SimulatorPanel({
  preview,
  busy,
  onRun,
  currency,
  amount,
  memberCount,
}: {
  preview: SimulatorPreview | null;
  busy: boolean;
  onRun: () => void;
  currency: string;
  amount: number;
  memberCount: number;
}) {
  if (!preview) {
    return <div className="text-xs text-muted-foreground">Loading simulator state…</div>;
  }
  if (!preview.ready) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        {preview.reason}
      </div>
    );
  }
  const halfPayout = (amount * memberCount) / 2;
  const phaseLabel = {
    collateral: "Collateral (Phase 1)",
    distribution: "Distribution (Phase 2)",
    terminal: "Terminal",
  }[preview.phase];
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Next click will run
          </span>
          <span className="text-sm font-semibold">
            Cycle {preview.nextCycle} — {phaseLabel}
          </span>
        </div>
        <Button size="sm" onClick={onRun} disabled={busy}>
          <FastForward /> {busy ? "Running…" : "Run next cycle"}
        </Button>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        <li>
          {preview.activeMembers} × {currency} {amount.toLocaleString()} contribution(s)
        </li>
        {preview.firstHalfRecipients.length > 0 && (
          <li>
            {preview.firstHalfRecipients.length} first-half payout(s) of {currency}{" "}
            {halfPayout.toLocaleString()} —{" "}
            {preview.firstHalfRecipients.map((m) => m.name).join(", ")}
          </li>
        )}
        {preview.secondHalfRecipients.length > 0 && (
          <li>
            {preview.secondHalfRecipients.length} second-half payout(s) of {currency}{" "}
            {halfPayout.toLocaleString()} — closes the rotation
          </li>
        )}
      </ul>
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
