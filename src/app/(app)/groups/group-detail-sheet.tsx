"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Beaker, Eye, FastForward, PauseCircle, PlayCircle, RefreshCw, ShieldCheck, ShieldPlus, Ban, Trash2, UserX, X, Wallet as WalletIcon } from "lucide-react";
import { useRouter } from "next/navigation";
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
  addMeAsObserver,
  cancelAndRefundGroup,
  clearAdminEscalation,
  isMockMoneyGroup,
  demoteDefaultedAdmin,
  kickDefaultedAdmin,
  securedPhase,
  setGroupStatus,
  subscribeLedger,
  subscribeSlots,
  takeOverAsCaretaker,
  transferOwnershipToManager,
  type Group,
  type LedgerEntry,
  type LedgerKind,
  type SlotSummary,
} from "@/lib/groups";
import { Badge } from "@/components/ui/badge";
import {
  groupPotId,
  mockPaymentProvider,
  type Wallet,
} from "@/lib/money/mock/mock-payment-provider";
import {
  previewNextCycle,
  runEscalationDetector,
  runNextCycle,
  type EscalationDiagnostic,
  type SimulatorPreview,
  type SimulatorRunResult,
} from "@/lib/simulator";
import { refillMemberWallets, trashMockGroup } from "@/lib/mock-groups";
import { Checkbox } from "@/components/ui/checkbox";

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
  const router = useRouter();
  const [busy, setBusy] = useState<
    "promote" | "status" | "clear" | "caretaker" | "cancel" | "simulate" | "join" | "trash" | "refill" | "detect" | "kick" | "demote" | null
  >(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [slots, setSlots] = useState<SlotSummary[] | null>(null);
  const [pot, setPot] = useState<Wallet | null>(null);
  const [simPreview, setSimPreview] = useState<SimulatorPreview | null>(null);
  const [skipSet, setSkipSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!group) {
      setLedger(null);
      return;
    }
    const unsub = subscribeLedger(group.id, setLedger, 25, () => setLedger([]));
    return unsub;
  }, [group?.id]);

  useEffect(() => {
    if (!group) {
      setSlots(null);
      return;
    }
    if (!group.useSlots) {
      setSlots([]);
      return;
    }
    const unsub = subscribeSlots(group.id, setSlots, () => setSlots([]));
    return unsub;
  }, [group?.id, group?.useSlots]);

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

  async function kickDefaulted() {
    if (!group) return;
    const summary =
      group.adminEscalationFlag === "both_default"
        ? "Kick BOTH the admin and the manager, refund their Phase 1 contributions from the pot, and take over as caretaker admin"
        : "Kick the admin, refund their Phase 1 contributions from the pot, and promote the manager to admin";
    if (!window.confirm(`${summary}. Continue?`)) return;
    setBusy("kick");
    try {
      const r = await kickDefaultedAdmin(group.id);
      const refundLines = Object.entries(r.refunds)
        .map(([uid, amt]) => `${uid.slice(0, 12)}…: ${group.currency} ${amt.toLocaleString()}`)
        .join(", ");
      toast.success(
        `${r.caretaker ? "Super admin took over" : "Manager promoted"}. Refunded: ${refundLines || "nothing"}.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function demoteDefaulted() {
    if (!group) return;
    if (
      !window.confirm(
        "Demote the defaulted admin (stays in the group as a regular member, no refund), promote the manager to admin with an (AdminPromo) suffix, and auto-promote the next non-defaulted member to manager. Continue?",
      )
    )
      return;
    setBusy("demote");
    try {
      const r = await demoteDefaultedAdmin(group.id);
      toast.success(
        `${r.demotedUid.slice(0, 12)}… demoted → ${r.newAdminUid.slice(0, 12)}… (AdminPromo). New manager: ${r.newManagerUid ? r.newManagerUid.slice(0, 12) + "…" : "unassigned"}.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function checkEscalation() {
    if (!group) return;
    setBusy("detect");
    try {
      const d = await runEscalationDetector(group.id);
      surfaceEscalationDiagnostic(d, group.currency);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Detector error: ${msg}`);
    } finally {
      setBusy(null);
    }
  }

  async function refillWallets() {
    if (!group) return;
    // Enough for the remaining cycles plus one buffer, sized to the group's
    // memberCount + amount so a full rotation still fits.
    const perMember = group.amount * group.memberCount + group.amount;
    setBusy("refill");
    try {
      const count = await refillMemberWallets(group.id, perMember);
      toast.success(
        `Refilled ${count} wallet(s) with ${group.currency} ${perMember.toLocaleString()} each.`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function trashGroup() {
    if (!group) return;
    if (
      !window.confirm(
        `Delete "${group.name}" and every synthetic member, wallet, payment, and ledger entry it created? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy("trash");
    try {
      await trashMockGroup(group.id);
      toast.success("Simulation group deleted.");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function joinAsObserver() {
    if (!group) return;
    setBusy("join");
    try {
      await addMeAsObserver(group.id);
      toast.success(
        "Added to this mock group as an observer. Open the mobile app and it'll appear in your groups list. Your account is now a test account — flip it back via Users when you're done.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function runSimulate() {
    if (!group) return;
    setBusy("simulate");
    try {
      const result: SimulatorRunResult = await runNextCycle(group.id, {
        skipMemberIds: skipSet,
      });
      const parts: string[] = [];
      if (result.contributions > 0) parts.push(`${result.contributions} contribution(s)`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
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
      if (result.escalation) {
        surfaceEscalationDiagnostic(result.escalation, group.currency);
      }
      // Skip selection persists across runs — the detector relies on
      // consistent missed cycles, and resetting after every click meant
      // the user had to re-tick every time. Use "Clear selections" in
      // the panel to reset explicitly.
      const next = await previewNextCycle(group.id);
      setSimPreview(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  function toggleSkip(memberId: string) {
    setSkipSet((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
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
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
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
                <Field
                  label="Phase (current)"
                  value={PHASE_LABELS[phase] ?? phase}
                />
                <Field
                  label="Cycle"
                  value={
                    group.currentCycle
                      ? `${group.currentCycle} / ${group.memberCount}${
                          group.currentCycle >= group.memberCount
                            ? " · closed"
                            : ""
                        }`
                      : `Not started (0 / ${group.memberCount})`
                  }
                />
                {(() => {
                  const next = (group.currentCycle ?? 0) + 1;
                  if (next > group.memberCount) return null;
                  const halfway = Math.floor(group.memberCount / 2);
                  const nextPhase =
                    next === group.memberCount
                      ? "Terminal"
                      : next > halfway
                        ? "Distribution (Phase 2)"
                        : "Collateral (Phase 1)";
                  return (
                    <Field
                      label="Next cycle"
                      value={`${next} — ${nextPhase}`}
                    />
                  );
                })()}
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
            {(flag === "admin_default" || flag === "both_default") && isMock && (
              <Button
                variant="destructive"
                disabled={busy !== null}
                onClick={kickDefaulted}
              >
                <UserX />{" "}
                {flag === "both_default"
                  ? "Kick admin + manager, refund, take over"
                  : "Kick defaulted admin, refund, promote manager"}
              </Button>
            )}
            {flag === "admin_default" && isMock && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={demoteDefaulted}
              >
                <UserX /> Demote admin (keep in group, promote manager to AdminPromo)
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={refillWallets}
                >
                  <RefreshCw /> Refill member wallets
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Adds {group.currency}{" "}
                  {(group.amount * group.memberCount + group.amount).toLocaleString()}{" "}
                  to every non-observer member&apos;s wallet — enough for a full
                  rotation of contributions plus one buffer.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={joinAsObserver}
                >
                  <Eye /> Add me as observer (mobile access)
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Flips your account to a test account and drops your uid into
                  memberIds so the mobile app shows this group in your list.
                  Position 999 keeps you out of the payout rotation. Flip back
                  in Users when done.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={trashGroup}
                  className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
                >
                  <Trash2 /> Trash this simulation
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Deletes the group, every synthetic sim_* user, all mock
                  wallets, and every payment + ledger entry. Real observer
                  accounts (yours) are left alone. No undo.
                </p>
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
                  skipSet={skipSet}
                  onToggleSkip={toggleSkip}
                  currency={group.currency}
                  amount={group.amount}
                  memberCount={group.memberCount}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={checkEscalation}
                >
                  <ShieldPlus /> Check escalation now (diagnostic)
                </Button>
              </div>
            </>
          )}

          {group.useSlots && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Slots ({slots?.length ?? "…"})
                </div>
                <SlotList slots={slots} adminUid={group.createdBy} />
              </div>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent ledger
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/groups/${group.id}/money-flow`)}
              >
                <BarChart3 /> Full money-flow report
              </Button>
            </div>
            <LedgerList entries={ledger} currency={group.currency} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SlotList({
  slots,
  adminUid,
}: {
  slots: SlotSummary[] | null;
  adminUid: string;
}) {
  if (slots === null) {
    return <div className="text-xs text-muted-foreground">Loading slots…</div>;
  }
  if (slots.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No slots — this useSlots group has an empty rotation.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {slots.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-muted-foreground">#{s.position}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{s.id}</span>
          </div>
          <div className="flex-1 truncate">
            {s.owners.length === 0
              ? <span className="italic text-muted-foreground">empty</span>
              : s.owners
                  .map(
                    (o) =>
                      `${o.name || o.userId.slice(0, 6)}${o.userId === adminUid ? " (admin)" : ""} ×${o.share}`,
                  )
                  .join(" + ")}
            {s.pendingSecondaryUserId && (
              <span className="ml-2 text-amber-600">→ pending</span>
            )}
          </div>
          {s.payoutCycle !== null && (
            <span className="text-[10px] text-blue-600">paid c{s.payoutCycle}</span>
          )}
        </div>
      ))}
    </div>
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
  skipSet,
  onToggleSkip,
  currency,
  amount,
  memberCount,
}: {
  preview: SimulatorPreview | null;
  busy: boolean;
  onRun: () => void;
  skipSet: Set<string>;
  onToggleSkip: (memberId: string) => void;
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
  const contributingCount = preview.activeMembers - skipSet.size;
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
          {contributingCount} × {currency} {amount.toLocaleString()} contribution(s)
          {skipSet.size > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              {" "}
              · {skipSet.size} skipped
            </span>
          )}
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
      <details className="rounded-md border bg-background/50 px-3 py-2 text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground">
          Skip contributions (persists across runs){" "}
          {skipSet.size > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              ({skipSet.size} selected)
            </span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-1.5">
          {skipSet.size > 0 && (
            <button
              type="button"
              onClick={() =>
                preview.activeMembersList
                  .filter((m) => skipSet.has(m.id))
                  .forEach((m) => onToggleSkip(m.id))
              }
              className="self-end rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              Clear all selections
            </button>
          )}
          {preview.activeMembersList.map((m) => {
            const checked = skipSet.has(m.id);
            return (
              <div
                key={m.id}
                role="checkbox"
                aria-checked={checked}
                tabIndex={0}
                onClick={() => onToggleSkip(m.id)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    onToggleSkip(m.id);
                  }
                }}
                className="flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/50"
              >
                <span className="flex items-center gap-2">
                  <Checkbox checked={checked} tabIndex={-1} />
                  <span className="tabular-nums text-muted-foreground">
                    #{m.position ?? "?"}
                  </span>
                  <span>{m.name}</span>
                  {m.role !== "member" && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {m.role}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {skipSet.size > 0 && (
            <p className="pt-1 text-[11px] italic text-muted-foreground">
              Skipped members simulate delinquency — they&apos;ll show as missing
              this cycle in the ledger. Open the group on the mobile app to
              trigger the escalation-flag detector.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

function surfaceEscalationDiagnostic(d: EscalationDiagnostic, _currency: string) {
  void _currency;
  if (d.flagWritten) {
    toast.warning(
      `Escalation flag raised: ${d.flagWritten}. Refresh to see intervention actions.`,
    );
    return;
  }
  switch (d.reason) {
    case "still_phase_1":
      toast.message(
        `Still in Phase 1 (cycle ${d.currentCycle}/${d.memberCount}, halfway ${d.halfway}). Detector fires once currentCycle >= halfway (${d.halfway}).`,
      );
      return;
    case "no_delinquency":
      toast.message(
        `No delinquency: admin paid ${d.adminPhase1Paid}/${d.phase1CyclesExpected} Phase 1 cycles, manager paid ${d.managerPhase1Paid ?? "n/a"}/${d.phase1CyclesExpected}. Did you tick admin in the skip checklist before every cycle?`,
      );
      return;
    case "flag_already_set":
      toast.message("Flag is already set on this group.");
      return;
    case "not_secured":
      toast.message("This is a Traditional group — escalation flag doesn't apply.");
      return;
    case "no_admin":
      toast.message("Group has no createdBy — nothing to check.");
      return;
    case "group_missing":
      toast.error("Group not found.");
      return;
    default:
      return;
  }
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
