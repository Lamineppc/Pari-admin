"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BarChart3,
  Beaker,
  Eye,
  FastForward,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldCheck,
  ShieldPlus,
  Ban,
  Trash2,
  UserX,
  X,
  Wallet as WalletIcon,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EscalationBadge } from "@/components/escalation-badge";
import {
  addMeAsObserver,
  cancelAndRefundGroup,
  clearAdminEscalation,
  isMockMoneyGroup,
  demoteDefaultedAdmin,
  kickDefaultedAdmin,
  securedPhase,
  addSlotForMember,
  cancelPendingSplit,
  forceAcceptSplit,
  healMissingSlots,
  kickMember,
  reassignSlotOwner,
  removeSlot,
  recordContributionAsSuperAdmin,
  recordPayoutAsSuperAdmin,
  resetMemberPayout,
  resyncMemberPositions,
  setGroupCurrentCycle,
  setPositionsLocked,
  updateGroupSettings,
  setGroupStatus,
  setMemberRole,
  subscribeGroup,
  subscribeGroupMembers,
  subscribeGroupPayments,
  subscribeLedger,
  subscribeSlots,
  swapMemberPositions,
  takeOverAsCaretaker,
  transferOwnershipToManager,
  type Group,
  type LedgerEntry,
  type LedgerKind,
  type MemberRole,
  type MemberSummary,
  type PaymentEntry,
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
import { broadcastToGroupMembers } from "@/lib/notifications";
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

export default function GroupDetailPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const groupId = params?.groupId ?? null;

  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [busy, setBusy] = useState<
    | "promote"
    | "status"
    | "clear"
    | "caretaker"
    | "cancel"
    | "simulate"
    | "join"
    | "trash"
    | "refill"
    | "detect"
    | "kick"
    | "demote"
    | null
  >(null);
  const [ledger, setLedger] = useState<LedgerEntry[] | null>(null);
  const [members, setMembers] = useState<MemberSummary[] | null>(null);
  const [payments, setPayments] = useState<PaymentEntry[] | null>(null);
  const [slots, setSlots] = useState<SlotSummary[] | null>(null);
  const [pot, setPot] = useState<Wallet | null>(null);
  const [simPreview, setSimPreview] = useState<SimulatorPreview | null>(null);
  const [skipSet, setSkipSet] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!groupId) return;
    const unsub = subscribeGroup(
      groupId,
      setGroup,
      (e) => {
        toast.error(e.message);
        setGroup(null);
      },
    );
    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const unsub = subscribeLedger(groupId, setLedger, 25, () => setLedger([]));
    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const unsub = subscribeGroupMembers(groupId, setMembers, () =>
      setMembers([]),
    );
    return unsub;
  }, [groupId]);

  useEffect(() => {
    if (!groupId) return;
    const unsub = subscribeGroupPayments(groupId, setPayments, () =>
      setPayments([]),
    );
    return unsub;
  }, [groupId]);

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

  if (group === undefined) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (group === null) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => router.push("/groups")}
        >
          <ArrowLeft /> Back to groups
        </Button>
        <div className="rounded-md border p-6 text-sm text-muted-foreground">
          Group not found. It may have been deleted.
        </div>
      </div>
    );
  }

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
      router.push("/groups");
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/groups")}
        >
          <ArrowLeft /> Back to groups
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/groups/${group.id}/money-flow`)}
        >
          <BarChart3 /> Full money-flow report
        </Button>
      </div>

      <header className="flex flex-col gap-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
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
        </h1>
        <p className="text-sm text-muted-foreground">
          {group.type === "secured" ? "Secured tontine" : "Traditional tontine"} —{" "}
          {group.description || "no description"}
        </p>
      </header>

      {isMock && (
        <div className="rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-200">
          <span className="font-semibold">Simulation — no real money.</span> All
          balances are mock. See docs/mock_money.md for details.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label="Status" value={isActive ? "Active" : "Inactive"} />
        <Field label="Members" value={String(group.memberCount)} />
        <Field label="Contribution" value={fmtCurrency(group.amount, group.currency)} />
        <Field label="Frequency" value={group.frequency} />
        {group.type === "secured" && (
          <>
            <Field label="Phase (current)" value={PHASE_LABELS[phase] ?? phase} />
            <Field
              label="Cycle"
              value={
                group.currentCycle
                  ? `${group.currentCycle} / ${group.memberCount}${
                      group.currentCycle >= group.memberCount ? " · closed" : ""
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
              return <Field label="Next cycle" value={`${next} — ${nextPhase}`} />;
            })()}
          </>
        )}
        <Field label="Created" value={fmtDate(group.createdAt)} />
        <Field label="Admin uid" value={group.createdBy} mono />
      </div>

      {group.adminEscalationFlag && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <div className="font-medium text-red-800 dark:text-red-200">Escalation raised</div>
          <div className="text-red-700 dark:text-red-300">
            {group.adminEscalationReason ?? "No reason recorded."}
          </div>
          <div className="text-xs text-red-600/80 dark:text-red-400/80">
            Flagged {fmtDate(group.adminEscalationFlaggedAt)}
          </div>
        </div>
      )}

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Super-admin actions
        </div>
        <div className="flex flex-wrap gap-2">
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
            <Button variant="destructive" disabled={busy !== null} onClick={kickDefaulted}>
              <UserX />{" "}
              {flag === "both_default"
                ? "Kick admin + manager, refund, take over"
                : "Kick defaulted admin, refund, promote manager"}
            </Button>
          )}
          {flag === "admin_default" && isMock && (
            <Button variant="outline" disabled={busy !== null} onClick={demoteDefaulted}>
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
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={refillWallets}
              >
                <RefreshCw /> Refill member wallets
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={joinAsObserver}
              >
                <Eye /> Add me as observer (mobile access)
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={trashGroup}
                className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
              >
                <Trash2 /> Trash this simulation
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Refill adds {group.currency}{" "}
              {(group.amount * group.memberCount + group.amount).toLocaleString()} to
              every non-observer member&apos;s wallet — enough for a full rotation of
              contributions plus one buffer. Observer flips your account to a test
              account and drops your uid into memberIds so the mobile app shows this
              group in your list. Trash deletes the group, every synthetic sim_* user,
              all mock wallets, and every payment + ledger entry. No undo.
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
              className="self-start"
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
            <SlotList
              groupId={group.id}
              slots={slots}
              adminUid={group.createdBy}
              members={members}
            />
          </div>
        </>
      )}

      <Separator />

      <SetupPanel
        groupId={group.id}
        useSlots={group.useSlots}
        currentCycle={group.currentCycle ?? 0}
        positionsLocked={group.positionsLocked}
        group={group}
      />

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Members ({members?.length ?? "…"})
        </div>
        <MemberList
          groupId={group.id}
          members={members}
          adminUid={group.createdBy}
          useSlots={group.useSlots}
          currency={group.currency}
          currentCycle={group.currentCycle ?? 1}
          defaultAmount={group.amount ?? 0}
          slots={slots}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Recent ledger
        </div>
        <LedgerList
          entries={ledger}
          currency={group.currency}
          payments={payments}
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Payments ({payments?.length ?? "…"})
        </div>
        <PaymentsList
          entries={payments}
          currency={group.currency}
          members={members}
        />
      </div>
    </div>
  );
}

// ── Full payments viewer with filters ──────────────────────────────────────

function PaymentsList({
  entries,
  currency,
  members,
}: {
  entries: PaymentEntry[] | null;
  currency: string;
  members: MemberSummary[] | null;
}) {
  const [cycleFilter, setCycleFilter] = useState<number | "all">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "contribution" | "payout">(
    "all",
  );
  const [userFilter, setUserFilter] = useState<string>("all");
  const [showVoided, setShowVoided] = useState(true);

  if (entries === null) {
    return <div className="text-xs text-muted-foreground">Loading payments…</div>;
  }
  if (entries.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No payments recorded yet.
      </div>
    );
  }
  const cycles = Array.from(new Set(entries.map((e) => e.cycleNumber))).sort(
    (a, b) => b - a,
  );
  const filtered = entries.filter((e) => {
    if (cycleFilter !== "all" && e.cycleNumber !== cycleFilter) return false;
    if (typeFilter !== "all" && e.type !== typeFilter) return false;
    if (userFilter !== "all" && e.userId !== userFilter) return false;
    if (!showVoided && e.status === "voided") return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-xs">
        <select
          value={cycleFilter === "all" ? "all" : String(cycleFilter)}
          onChange={(e) =>
            setCycleFilter(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="rounded-md border bg-background px-2 py-1"
        >
          <option value="all">all cycles</option>
          {cycles.map((c) => (
            <option key={c} value={c}>
              cycle {c}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="rounded-md border bg-background px-2 py-1"
        >
          <option value="all">all types</option>
          <option value="contribution">contributions</option>
          <option value="payout">payouts</option>
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-1"
        >
          <option value="all">all members</option>
          {(members ?? []).map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name || m.userId.slice(0, 6)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1">
          <Checkbox
            checked={showVoided}
            onCheckedChange={(v) => setShowVoided(v === true)}
          />
          show voided
        </label>
        <div className="ml-auto text-muted-foreground">
          {filtered.length} of {entries.length}
        </div>
      </div>
      <div className="flex max-h-96 flex-col gap-1 overflow-auto">
        {filtered.map((p) => {
          const voided = p.status === "voided";
          return (
            <div
              key={p.id}
              className={
                "flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs " +
                (voided ? "opacity-60 line-through" : "")
              }
            >
              <span className="font-mono text-muted-foreground">
                c{p.cycleNumber}
              </span>
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                  (p.type === "payout"
                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200")
                }
              >
                {p.type}
              </span>
              <span className="flex-1 truncate">
                {p.userName || p.userId.slice(0, 6)}
                {p.slotId && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    · slot {p.slotId.slice(0, 6)}
                  </span>
                )}
              </span>
              {p.isLate && (
                <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  late
                </span>
              )}
              {voided && (
                <span className="rounded bg-red-100 px-1 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-200">
                  voided
                </span>
              )}
              <span className="font-mono">
                {currency} {p.amount.toLocaleString()}
              </span>
              {p.paidAt && (
                <span className="text-[10px] text-muted-foreground">
                  {p.paidAt.toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No payments match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Setup healing panel ────────────────────────────────────────────────────

function SetupPanel({
  groupId,
  useSlots,
  currentCycle,
  positionsLocked,
  group,
}: {
  groupId: string;
  useSlots: boolean;
  currentCycle: number;
  positionsLocked: boolean;
  group: Group;
}) {
  const [cycleInput, setCycleInput] = useState<number>(currentCycle);
  const [busy, setBusy] = useState<string | null>(null);
  const [editingSettings, setEditingSettings] = useState(false);
  const [notifying, setNotifying] = useState(false);

  useEffect(() => {
    setCycleInput(currentCycle);
  }, [currentCycle]);

  async function run<T>(key: string, fn: () => Promise<T>, ok: (r: T) => string) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(ok(r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${key} failed.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Setup healing
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <span className="w-28 text-xs text-muted-foreground">Current cycle</span>
          <input
            type="number"
            min={0}
            value={cycleInput}
            onChange={(e) => setCycleInput(Number(e.target.value))}
            className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "cycle" || cycleInput === currentCycle}
            onClick={() =>
              run(
                "cycle",
                () => setGroupCurrentCycle(groupId, cycleInput),
                () => `currentCycle set to ${cycleInput}.`,
              )
            }
          >
            set
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-md border p-2 text-sm">
          <span className="flex-1 text-xs text-muted-foreground">
            Positions {positionsLocked ? "locked" : "unlocked"}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "lock"}
            onClick={() =>
              run(
                "lock",
                () => setPositionsLocked(groupId, !positionsLocked),
                () =>
                  positionsLocked ? "Positions unlocked." : "Positions locked.",
              )
            }
          >
            {positionsLocked ? "unlock" : "lock"}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={busy === "resync"}
          onClick={() =>
            run(
              "resync",
              () => resyncMemberPositions(groupId),
              (r) =>
                r.updated === 0
                  ? "Positions already contiguous."
                  : `Renumbered ${r.updated} member position(s).`,
            )
          }
        >
          Resync member positions
        </Button>
        {useSlots && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy === "heal"}
            onClick={() =>
              run(
                "heal",
                () => healMissingSlots(groupId),
                (r) =>
                  r.added === 0
                    ? "No missing slots."
                    : `Added ${r.added} missing slot(s).`,
              )
            }
          >
            Heal missing slots
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditingSettings(true)}
        >
          Edit settings
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setNotifying(true)}
        >
          Notify members
        </Button>
      </div>
      {editingSettings && (
        <GroupSettingsDialog
          group={group}
          onClose={() => setEditingSettings(false)}
        />
      )}
      {notifying && (
        <NotifyMembersDialog
          groupId={groupId}
          onClose={() => setNotifying(false)}
        />
      )}
    </div>
  );
}

function NotifyMembersDialog({
  groupId,
  onClose,
}: {
  groupId: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const r = await broadcastToGroupMembers({ groupId, title, body });
      toast.success(`Delivered to ${r.sent} of ${r.totalTargets} member(s).`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Broadcast failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Notify group members</h3>
            <p className="text-xs text-muted-foreground">
              Delivers one notification to every non-kicked member's inbox.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-start gap-2">
            <label className="w-20 pt-1 text-xs text-muted-foreground">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="What do members need to know?"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupSettingsDialog({
  group,
  onClose,
}: {
  group: Group;
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description);
  const [amount, setAmount] = useState<number>(group.amount);
  const [frequency, setFrequency] = useState<string>(group.frequency);
  const [penalty, setPenalty] = useState<number>(group.penaltyPerMissedCycle);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await updateGroupSettings(group.id, {
        name,
        description,
        amount,
        frequency,
        penaltyPerMissedCycle: penalty,
      });
      toast.success("Group settings updated.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Edit group settings</h3>
            <p className="text-xs text-muted-foreground">
              Super-admin override — validated inline, audit-logged.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-28 text-xs text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-start gap-2">
            <label className="w-28 pt-1 text-xs text-muted-foreground">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-xs text-muted-foreground">
              Amount ({group.currency})
            </label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-xs text-muted-foreground">Frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="Weekly">Weekly</option>
              <option value="Bi-weekly">Bi-weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-28 text-xs text-muted-foreground">
              Penalty / miss
            </label>
            <input
              type="number"
              min={0}
              value={penalty}
              onChange={(e) => setPenalty(Number(e.target.value))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Members list with super-admin per-row controls ─────────────────────────

function MemberList({
  groupId,
  members,
  adminUid,
  useSlots,
  currency,
  currentCycle,
  defaultAmount,
  slots,
}: {
  groupId: string;
  members: MemberSummary[] | null;
  adminUid: string;
  useSlots: boolean;
  currency: string;
  currentCycle: number;
  defaultAmount: number;
  slots: SlotSummary[] | null;
}) {
  const [swapSelection, setSwapSelection] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recordFor, setRecordFor] = useState<MemberSummary | null>(null);

  if (members === null) {
    return <Skeleton className="h-24 w-full" />;
  }
  if (members.length === 0) {
    return <div className="text-sm text-muted-foreground">No members.</div>;
  }

  async function changeRole(userId: string, role: MemberRole) {
    setBusy(`role:${userId}`);
    try {
      await setMemberRole(groupId, userId, role);
      toast.success("Role updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change role.");
    } finally {
      setBusy(null);
    }
  }

  async function triggerKick(m: MemberSummary) {
    if (useSlots) {
      toast.error("Kick on split-slot groups lands in PR-1b's slot management.");
      return;
    }
    if (m.payoutCycle != null) {
      const ok = window.confirm(
        `${m.name || "This member"} has already received their payout for cycle ${m.payoutCycle}. Kicking now won't return money to the pot — the member keeps what they've already been paid. Continue?`,
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        `Kick ${m.name || "this member"} from the group? Any active contributions they've recorded will be voided and refunded from the pot to their wallet.`,
      );
      if (!ok) return;
    }
    setBusy(`kick:${m.userId}`);
    try {
      const r = await kickMember(groupId, m.userId);
      toast.success(
        r.refundAmount > 0
          ? `Kicked. Refunded ${currency} ${r.refundAmount.toLocaleString()} across ${r.voidedPayments} voided contribution(s).`
          : `Kicked. No active contributions to refund.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kick failed.");
    } finally {
      setBusy(null);
    }
  }

  async function triggerReset(m: MemberSummary) {
    if (useSlots) {
      toast.error("Payout reset on split-slot groups lands in PR-1b's slot management.");
      return;
    }
    const label = m.name || "this member";
    const parts: string[] = [];
    if (m.payoutCycle != null) {
      parts.push(`the payout for cycle ${m.payoutCycle} (wallet → pot)`);
    }
    parts.push("every non-voided contribution (pot → wallet)");
    const ok = window.confirm(
      `Reset ${label}? This voids ${parts.join(" AND ")}. Group currentCycle is NOT rolled back — use Cycle Correction if you also want that.`,
    );
    if (!ok) return;
    setBusy(`reset:${m.userId}`);
    try {
      const r = await resetMemberPayout(groupId, m.userId);
      const bits: string[] = [];
      if (r.reversedPayoutAmount > 0) {
        bits.push(
          `reversed ${currency} ${r.reversedPayoutAmount.toLocaleString()} payout`,
        );
      }
      if (r.refundedContribAmount > 0) {
        bits.push(
          `refunded ${currency} ${r.refundedContribAmount.toLocaleString()} contribs`,
        );
      }
      toast.success(
        `Reset — ${bits.join(", ") || "no money moved"} across ${r.voidedPayments} voided doc(s).`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusy(null);
    }
  }

  async function triggerSwap(userId: string) {
    if (useSlots) {
      toast.error(
        "Position swap not available on split-slot groups yet. Use PR-1b's slot management.",
      );
      return;
    }
    if (swapSelection === null) {
      setSwapSelection(userId);
      toast.info("Pick the second member to swap with.");
      return;
    }
    if (swapSelection === userId) {
      setSwapSelection(null);
      return;
    }
    const other = swapSelection;
    setSwapSelection(null);
    // Warn if either member already received their payout — swap after
    // that point rewrites cycle history in confusing ways.
    const a = members?.find((m) => m.userId === userId);
    const b = members?.find((m) => m.userId === other);
    if (a?.payoutCycle != null || b?.payoutCycle != null) {
      const ok = window.confirm(
        "One of these members has already been paid out. Swapping their position after a payout can misalign cycle history. Continue?",
      );
      if (!ok) return;
    }
    setBusy(`swap:${userId}`);
    try {
      await swapMemberPositions(groupId, userId, other);
      toast.success("Positions swapped.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not swap positions.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {members.map((m) => {
        const isCreator = m.userId === adminUid;
        const isSelected = swapSelection === m.userId;
        const paid = m.payoutCycle != null;
        const roleBusy = busy === `role:${m.userId}`;
        const swapBusy = busy === `swap:${m.userId}`;
        // −slot only touches slots that this member gained via +slot
        // (addedByAdmin=true). Originals from group creation stay
        // untouchable so the rotation can't be shrunk out from under
        // a member who was there from day one.
        const removableSlots = (slots ?? [])
          .filter(
            (s) =>
              s.addedByAdmin &&
              s.payoutCycle == null &&
              s.owners.length === 1 &&
              s.owners[0]!.userId === m.userId &&
              Math.abs(s.owners[0]!.share - 1.0) < 1e-6,
          )
          .sort((a, b) => b.position - a.position);
        const canRemoveSlot = removableSlots.length >= 1;
        return (
          <div
            key={m.userId}
            className={
              "flex items-center gap-3 rounded-md border p-2 text-sm " +
              (isSelected ? "border-primary bg-primary/5" : "")
            }
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-sm border text-xs font-semibold text-muted-foreground">
              #{m.position}
            </div>
            <div className="flex flex-1 flex-col">
              <span className="font-medium">
                {m.name || m.userId.slice(0, 6)}
                {isCreator && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    creator
                  </Badge>
                )}
                {m.kicked && (
                  <Badge variant="destructive" className="ml-2 text-[10px]">
                    kicked
                  </Badge>
                )}
                {paid && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    paid out (c{m.payoutCycle})
                  </Badge>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {m.role} · joined c{m.joinCycle}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <select
                value={m.role}
                disabled={roleBusy}
                onChange={(e) => changeRole(m.userId, e.target.value as MemberRole)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="admin">admin</option>
                <option value="manager">manager</option>
                <option value="member">member</option>
              </select>
              <Button
                variant={isSelected ? "default" : "outline"}
                size="sm"
                disabled={swapBusy}
                onClick={() => triggerSwap(m.userId)}
              >
                {isSelected ? "cancel" : "swap"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === `reset:${m.userId}`}
                onClick={() => triggerReset(m)}
                title="Reset payout + refund all non-voided contributions"
              >
                reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRecordFor(m)}
                title="Record a contribution or payout on this member's behalf"
              >
                record
              </Button>
              {useSlots && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === `add-slot:${m.userId}`}
                    onClick={async () => {
                      setBusy(`add-slot:${m.userId}`);
                      try {
                        const r = await addSlotForMember(
                          groupId,
                          m.userId,
                          m.name,
                        );
                        toast.success(
                          `Added slot #${r.position} for ${m.name || "member"}.`,
                        );
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Add slot failed.",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                    title="Add an extra slot (tail) for this member"
                  >
                    +slot
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canRemoveSlot || busy === `sub-slot:${m.userId}`}
                    onClick={async () => {
                      const target = removableSlots[0]!;
                      if (
                        !window.confirm(
                          `Remove ${m.name || "member"}'s slot #${target.position}? Slots after it will shift down by 1.`,
                        )
                      ) {
                        return;
                      }
                      setBusy(`sub-slot:${m.userId}`);
                      try {
                        await removeSlot(groupId, target.id);
                        toast.success(
                          `Removed slot #${target.position} from ${m.name || "member"}.`,
                        );
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Remove slot failed.",
                        );
                      } finally {
                        setBusy(null);
                      }
                    }}
                    title={
                      canRemoveSlot
                        ? "Remove one super-admin-added slot from this member"
                        : "Only slots added via +slot can be removed here"
                    }
                  >
                    −slot
                  </Button>
                </>
              )}
              <Button
                variant="destructive"
                size="sm"
                disabled={busy === `kick:${m.userId}` || isCreator}
                onClick={() => triggerKick(m)}
                title={isCreator ? "Cannot kick the group creator here" : "Kick + refund"}
              >
                kick
              </Button>
            </div>
          </div>
        );
      })}
      {swapSelection !== null && (
        <div className="text-xs text-muted-foreground">
          Pick the target member to complete the swap, or press cancel.
        </div>
      )}
      {recordFor && (
        <RecordPaymentDialog
          member={recordFor}
          groupId={groupId}
          useSlots={useSlots}
          currency={currency}
          currentCycle={currentCycle}
          defaultAmount={defaultAmount}
          onClose={() => setRecordFor(null)}
        />
      )}
    </div>
  );
}

function RecordPaymentDialog({
  member,
  groupId,
  useSlots,
  currency,
  currentCycle,
  defaultAmount,
  onClose,
}: {
  member: MemberSummary;
  groupId: string;
  useSlots: boolean;
  currency: string;
  currentCycle: number;
  defaultAmount: number;
  onClose: () => void;
}) {
  const [type, setType] = useState<"contribution" | "payout">("contribution");
  const [cycle, setCycle] = useState<number>(currentCycle);
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [isLate, setIsLate] = useState(false);
  const [penalty, setPenalty] = useState<number>(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (useSlots) {
      toast.error(
        "Direct record on split-slot groups lands with slot management.",
      );
      return;
    }
    if (amount <= 0 || cycle <= 0) {
      toast.error("Enter a positive cycle and amount.");
      return;
    }
    setSaving(true);
    try {
      if (type === "contribution") {
        await recordContributionAsSuperAdmin({
          groupId,
          userId: member.userId,
          userName: member.name || member.userId.slice(0, 6),
          cycleNumber: cycle,
          amount,
          isLate,
          penaltyAmount: penalty,
          note: note.trim() || undefined,
        });
      } else {
        await recordPayoutAsSuperAdmin({
          groupId,
          userId: member.userId,
          userName: member.name || member.userId.slice(0, 6),
          cycleNumber: cycle,
          amount,
          note: note.trim() || undefined,
        });
      }
      toast.success(
        `Recorded ${type} of ${currency} ${amount.toLocaleString()} for cycle ${cycle}.`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Record failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Record for {member.name || member.userId.slice(0, 6)}
            </h3>
            <p className="text-xs text-muted-foreground">
              Super-admin write path. Mock money moves accordingly; real-money
              groups will throw.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="contribution">contribution</option>
              <option value="payout">payout</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">Cycle #</label>
            <input
              type="number"
              min={1}
              value={cycle}
              onChange={(e) => setCycle(Number(e.target.value))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">
              Amount ({currency})
            </label>
            <input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          {type === "contribution" && (
            <>
              <div className="flex items-center gap-2">
                <label className="w-24 text-xs text-muted-foreground">Late?</label>
                <Checkbox
                  checked={isLate}
                  onCheckedChange={(v) => setIsLate(v === true)}
                />
                <span className="text-xs text-muted-foreground">
                  Flags the contribution as late (isLate=true).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="w-24 text-xs text-muted-foreground">
                  Penalty ({currency})
                </label>
                <input
                  type="number"
                  min={0}
                  value={penalty}
                  onChange={(e) => setPenalty(Number(e.target.value))}
                  className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                />
              </div>
            </>
          )}
          <div className="flex items-start gap-2">
            <label className="w-24 pt-1 text-xs text-muted-foreground">Note</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why this manual record?"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Recording…" : "Record"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SlotList({
  groupId,
  slots,
  adminUid,
  members,
}: {
  groupId: string;
  slots: SlotSummary[] | null;
  adminUid: string;
  members: MemberSummary[] | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<SlotSummary | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, ok: (r: T) => string) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(ok(r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${key} failed.`);
    } finally {
      setBusy(null);
    }
  }

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
      {slots.map((s) => {
        const isSolo =
          s.owners.length === 1 && Math.abs(s.owners[0]!.share - 1.0) < 1e-6;
        const paid = s.payoutCycle !== null;
        const hasPending = !!s.pendingSecondaryUserId;
        return (
          <div
            key={s.id}
            className="flex flex-col gap-1 rounded border px-2 py-1.5 text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-muted-foreground">
                #{s.position}
              </span>
              <div className="flex-1 truncate">
                {s.owners.length === 0 ? (
                  <span className="italic text-muted-foreground">empty</span>
                ) : (
                  s.owners
                    .map(
                      (o) =>
                        `${o.name || o.userId.slice(0, 6)}${o.userId === adminUid ? " (admin)" : ""} ×${o.share}`,
                    )
                    .join(" + ")
                )}
                {hasPending && (
                  <span className="ml-2 text-amber-600">→ pending secondary</span>
                )}
              </div>
              {paid && (
                <span className="text-[10px] text-blue-600">
                  paid c{s.payoutCycle}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {hasPending && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `accept:${s.id}`}
                    onClick={() =>
                      run(
                        `accept:${s.id}`,
                        () => forceAcceptSplit(groupId, s.id),
                        () => "Split accepted on invitee's behalf.",
                      )
                    }
                  >
                    accept split
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === `cancel:${s.id}`}
                    onClick={() =>
                      run(
                        `cancel:${s.id}`,
                        () => cancelPendingSplit(groupId, s.id),
                        () => "Pending split cleared.",
                      )
                    }
                  >
                    cancel split
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={!isSolo || paid}
                onClick={() => setReassignFor(s)}
                title={
                  paid
                    ? "Cannot reassign a paid-out slot"
                    : isSolo
                      ? "Reassign owner"
                      : "Only solo slots"
                }
              >
                reassign
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={paid || busy === `remove:${s.id}`}
                onClick={() => {
                  if (
                    !window.confirm(
                      `Remove slot #${s.position}? Slots after it will shift down by 1.`,
                    )
                  )
                    return;
                  run(
                    `remove:${s.id}`,
                    () => removeSlot(groupId, s.id),
                    (r) => `Slot removed. Shifted ${r.shifted} slot(s).`,
                  );
                }}
                title={paid ? "Cannot remove a paid-out slot" : "Remove slot"}
              >
                remove
              </Button>
            </div>
          </div>
        );
      })}
      {reassignFor && (
        <SlotReassignDialog
          slot={reassignFor}
          members={members}
          groupId={groupId}
          onClose={() => setReassignFor(null)}
        />
      )}
    </div>
  );
}

function SlotReassignDialog({
  slot,
  members,
  groupId,
  onClose,
}: {
  slot: SlotSummary;
  members: MemberSummary[] | null;
  groupId: string;
  onClose: () => void;
}) {
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const eligible = (members ?? []).filter((m) => !m.kicked);

  async function save() {
    const m = eligible.find((x) => x.userId === selectedUid);
    if (!m) {
      toast.error("Pick a member.");
      return;
    }
    setSaving(true);
    try {
      await reassignSlotOwner(groupId, slot.id, m.userId, m.name);
      toast.success(`Slot #${slot.position} reassigned to ${m.name}.`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reassign failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Reassign slot #{slot.position}</h3>
            <p className="text-xs text-muted-foreground">
              Current owner: {slot.owners[0]?.name ?? "—"}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <select
          value={selectedUid}
          onChange={(e) => setSelectedUid(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
        >
          <option value="">— pick a member —</option>
          {eligible.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name || m.userId.slice(0, 6)} (#{m.position})
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Reassign"}
          </Button>
        </div>
      </div>
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
  payments,
}: {
  entries: LedgerEntry[] | null;
  currency: string;
  payments: PaymentEntry[] | null;
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
  // Ledger entries are immutable — voiding a payment doesn't rewrite
  // them. Cross-reference paymentId against the payments stream so we
  // can decorate a ledger row when the payment it points at was later
  // voided, keeping the audit trail readable without altering data.
  //
  // Older ledger entries (pre-paymentId rollout) don't carry the
  // paymentId field, so we also flag any contribution/payout entry
  // that has NO matching non-voided payment for its (userId, cycle,
  // kind) tuple. That's a strong indicator the underlying payment was
  // voided later even without the id backreference.
  const voidedPaymentIds = new Set(
    (payments ?? [])
      .filter((p) => p.status === "voided")
      .map((p) => p.id),
  );
  const activeContribKeys = new Set(
    (payments ?? [])
      .filter((p) => p.status !== "voided" && p.type === "contribution")
      .map((p) => `${p.userId}_c${p.cycleNumber}`),
  );
  const activePayoutKeys = new Set(
    (payments ?? [])
      .filter((p) => p.status !== "voided" && p.type === "payout")
      .map((p) => `${p.userId}_c${p.cycleNumber}`),
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] text-muted-foreground">
        Newest 25 entries. Older history stays queryable via ledger export.
      </div>
      {entries.map((e) => {
        const key = `${e.userId}_c${e.cycleNumber}`;
        const linkedVoid =
          e.paymentId != null && voidedPaymentIds.has(e.paymentId);
        const orphaned =
          (e.kind === "contribution" && !activeContribKeys.has(key)) ||
          (e.kind === "payout" && !activePayoutKeys.has(key));
        const voided = linkedVoid || orphaned;
        return (
          <div
            key={e.id}
            className={
              "flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 " +
              (voided ? "opacity-60" : "")
            }
          >
            <div className="flex flex-1 flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={LEDGER_STYLES[e.kind]}>
                  {e.kind}
                </Badge>
                <span className="text-xs text-muted-foreground">cycle {e.cycleNumber}</span>
                {voided && (
                  <span className="rounded bg-red-100 px-1 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-200">
                    payment voided
                  </span>
                )}
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
            <div
              className={
                "tabular-nums text-sm font-medium " +
                (voided ? "line-through" : "")
              }
            >
              {currency} {e.amount.toLocaleString()}
            </div>
          </div>
        );
      })}
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
