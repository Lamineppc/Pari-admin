"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, RotateCcw, Search, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { subscribeGroups, type Group } from "@/lib/groups";
import {
  isCycleWipeAllowed,
  loadCycleLedger,
  loadCyclePayments,
  reverseLedgerEntry,
  wipeCycleData,
  type LedgerEntryRecord,
  type PaymentModel,
} from "@/lib/cycle-correction";

type Mode = "wipe" | "reverse";

export default function CycleCorrectionPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [mode, setMode] = useState<Mode>("wipe");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Group | null>(null);
  const [cycle, setCycle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = subscribeGroups(setGroups, (e) => {
      toast.error(e.message);
      setGroups([]);
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    if (!groups) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(needle) ||
        g.id.toLowerCase().includes(needle),
    );
  }, [groups, q]);

  function reset() {
    setStep(0);
    setSelected(null);
    setCycle(null);
    setMode("wipe");
  }

  function back() {
    if (step === 2) {
      setStep(1);
      setCycle(null);
    } else if (step === 1) {
      setStep(0);
      setSelected(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Wrench className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Cycle correction
            </h1>
            <p className="text-sm text-muted-foreground">
              Two paths: destructive wipe (mock / never-started groups only)
              and reversal (live-money groups — appends compensating ledger
              entries without deleting history).
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StepIndicator active={step === 0} completed={step > 0} label="1 · Pick group" />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator active={step === 1} completed={step > 1} label="2 · Pick cycle" />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator
            active={step === 2}
            completed={false}
            label={mode === "wipe" ? "3 · Confirm + wipe" : "3 · Pick + reverse entry"}
          />
        </div>
      </header>

      {step > 0 && (
        <Button variant="outline" size="sm" onClick={back} className="self-start">
          <ArrowLeft /> Back
        </Button>
      )}

      {step === 0 && (
        <GroupStep
          groups={filtered}
          q={q}
          onQ={setQ}
          onPick={(g, m) => {
            setSelected(g);
            setMode(m);
            setStep(1);
          }}
        />
      )}

      {step === 1 && selected && (
        <CycleStep
          group={selected}
          mode={mode}
          onPick={(c) => {
            setCycle(c);
            setStep(2);
          }}
        />
      )}

      {step === 2 && selected && cycle != null && mode === "wipe" && (
        <ConfirmWipeStep
          group={selected}
          cycle={cycle}
          busy={busy}
          onDone={reset}
          setBusy={setBusy}
        />
      )}

      {step === 2 && selected && cycle != null && mode === "reverse" && (
        <ReverseStep
          group={selected}
          cycle={cycle}
          busy={busy}
          onDone={reset}
          setBusy={setBusy}
        />
      )}
    </div>
  );
}

function StepIndicator({
  active,
  completed,
  label,
}: {
  active: boolean;
  completed: boolean;
  label: string;
}) {
  return (
    <span
      className={
        active
          ? "rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary"
          : completed
            ? "rounded-md bg-muted px-2 py-0.5 font-medium text-foreground"
            : "px-2 py-0.5 text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

function GroupStep({
  groups,
  q,
  onQ,
  onPick,
}: {
  groups: Group[] | null;
  q: string;
  onQ: (v: string) => void;
  onPick: (g: Group, mode: Mode) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
        <span className="font-semibold">Wipe vs reverse.</span>{" "}
        Mock groups and never-started groups (currentCycle == 0) go through
        the destructive wipe path. Live-money groups with real payments go
        through the reversal path — pick a specific ledger entry and the
        panel appends a compensating entry with a negated amount, keeping
        the original intact.
      </div>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or group id…"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Current cycle</TableHead>
              <TableHead>Path</TableHead>
              <TableHead className="text-right">Members</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups === null && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {groups?.map((g) => {
              const gate = isCycleWipeAllowed({
                moneyProvider: g.moneyProvider,
                currentCycle: g.currentCycle,
              });
              const groupMode: Mode = gate.allowed ? "wipe" : "reverse";
              return (
                <TableRow
                  key={g.id}
                  onClick={() => onPick(g, groupMode)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    <Badge variant={g.type === "secured" ? "default" : "secondary"}>
                      {g.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.currentCycle ?? 0} / {g.memberCount}
                  </TableCell>
                  <TableCell>
                    {gate.allowed ? (
                      <Badge variant="secondary">Wipe (eligible)</Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                      >
                        Reverse (live money)
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {g.memberCount}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CycleStep({
  group,
  mode,
  onPick,
}: {
  group: Group;
  mode: Mode;
  onPick: (n: number) => void;
}) {
  const current = group.currentCycle ?? 0;
  const cycles = Array.from({ length: Math.max(current, 1) }, (_, i) => i + 1);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Pick which cycle to {mode === "wipe" ? "wipe" : "inspect for reversal"}{" "}
        on <span className="font-medium">{group.name}</span>.
        {mode === "wipe"
          ? " Wiping cycle N deletes every payment record with cycleNumber == N and resets group.currentCycle back to N."
          : " You'll see every ledger entry recorded on this cycle and choose which one to compensate."}
      </p>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {cycles.map((c) => (
          <Button
            key={c}
            variant="outline"
            className="h-16 flex-col gap-1"
            onClick={() => onPick(c)}
          >
            <span className="text-xs text-muted-foreground">Cycle</span>
            <span className="text-lg font-semibold">{c}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

function ConfirmWipeStep({
  group,
  cycle,
  busy,
  setBusy,
  onDone,
}: {
  group: Group;
  cycle: number;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const [payments, setPayments] = useState<PaymentModel[] | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    setPayments(null);
    loadCyclePayments(group.id, cycle).then(setPayments).catch((e) => {
      toast.error(e instanceof Error ? e.message : String(e));
      setPayments([]);
    });
  }, [group.id, cycle]);

  const expected = `${group.name} cycle ${cycle}`;
  const canConfirm = confirmText.trim() === expected;

  async function apply() {
    setBusy(true);
    try {
      const r = await wipeCycleData(group.id, cycle);
      toast.success(
        `Wiped ${r.paymentsDeleted} payment(s) and unpaid ${r.membersUnpaid} member(s). currentCycle reset to ${cycle}.`,
      );
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
        <div className="flex items-center gap-2 font-medium text-red-800 dark:text-red-200">
          <AlertTriangle className="h-4 w-4" />
          Irreversible action
        </div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-red-700 dark:text-red-300">
          <li>Deletes every payment record on <b>{group.name}</b> with cycleNumber == {cycle}.</li>
          <li>Clears payoutCycle on every member marked paid that cycle.</li>
          <li>Sets group.currentCycle back to {cycle}.</li>
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Payments that will be deleted
        </div>
        {payments === null ? (
          <Skeleton className="h-16 w-full" />
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No payment records found for cycle {cycle}. Wiping still resets
            currentCycle back to {cycle}.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">{p.userName || p.userId.slice(0, 12)}</TableCell>
                    <TableCell>
                      <Badge variant={p.type === "payout" ? "default" : "secondary"}>
                        {p.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.currency} {p.amount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.status ?? (p.isLate ? "late" : "active")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="confirm">
          Type <span className="font-mono text-xs">{expected}</span> to confirm
        </Label>
        <Input
          id="confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={expected}
        />
      </div>

      <Button
        variant="destructive"
        disabled={!canConfirm || busy}
        onClick={apply}
      >
        {busy ? "Wiping…" : `Wipe cycle ${cycle} on ${group.name}`}
      </Button>
    </div>
  );
}

const KIND_STYLES: Record<string, string> = {
  contribution: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  payout: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  refund: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  penalty: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

function ReverseStep({
  group,
  cycle,
  busy,
  setBusy,
  onDone,
}: {
  group: Group;
  cycle: number;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const [entries, setEntries] = useState<LedgerEntryRecord[] | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [clearPayout, setClearPayout] = useState(true);

  useEffect(() => {
    setEntries(null);
    setPickedId(null);
    setReason("");
    loadCycleLedger(group.id, cycle)
      .then(setEntries)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : String(e));
        setEntries([]);
      });
  }, [group.id, cycle]);

  const picked = useMemo(
    () => entries?.find((e) => e.id === pickedId) ?? null,
    [entries, pickedId],
  );

  const alreadyReversedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries ?? []) {
      if (e.reversesEntryId) s.add(e.reversesEntryId);
    }
    return s;
  }, [entries]);

  async function apply() {
    if (!picked) return;
    setBusy(true);
    try {
      const isTest = group.moneyProvider === "mock";
      const r = await reverseLedgerEntry({
        groupId: group.id,
        original: picked,
        reason,
        clearMemberPayoutCycle: clearPayout && picked.kind === "payout",
        isTest,
      });
      toast.success(`Reversal recorded (${r.reversalEntryId}).`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canApply = !!picked && reason.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/40">
        <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
          <RotateCcw className="h-4 w-4" />
          Non-destructive reversal
        </div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-amber-700 dark:text-amber-300">
          <li>Appends a compensating ledger entry with a negated amount.</li>
          <li>Keeps the original entry intact — money-flow rollups net to zero for the reversed event.</li>
          <li>
            Reversing a <b>payout</b> optionally clears the receiving member&apos;s
            payoutCycle so the rotation can re-award that slot.
          </li>
        </ul>
      </div>

      <div className="rounded-md border p-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ledger entries on cycle {cycle}
        </div>
        {entries === null ? (
          <Skeleton className="h-16 w-full" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No ledger entries found for cycle {cycle}.
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Pick</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const isReversal = !!e.reversesEntryId;
                  const alreadyReversed = alreadyReversedIds.has(e.id);
                  const canPick = !isReversal && !alreadyReversed;
                  const isPicked = e.id === pickedId;
                  return (
                    <TableRow
                      key={e.id}
                      className={
                        isPicked
                          ? "bg-primary/5"
                          : canPick
                            ? "cursor-pointer"
                            : "opacity-60"
                      }
                      onClick={canPick ? () => setPickedId(e.id) : undefined}
                    >
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${KIND_STYLES[e.kind] ?? ""}`}
                        >
                          {e.kind}
                        </Badge>
                        {isReversal && (
                          <Badge variant="secondary" className="ml-1 text-[10px]">
                            reversal
                          </Badge>
                        )}
                        {alreadyReversed && (
                          <Badge variant="secondary" className="ml-1 text-[10px]">
                            reversed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className="truncate font-mono text-[10px]"
                        title={e.userId}
                      >
                        {e.userId.length > 12 ? `${e.userId.slice(0, 12)}…` : e.userId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.currency} {e.amount.toLocaleString()}
                      </TableCell>
                      <TableCell
                        className="max-w-[16rem] truncate text-xs text-muted-foreground"
                        title={e.note ?? undefined}
                      >
                        {e.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canPick ? (
                          <Button
                            size="sm"
                            variant={isPicked ? "default" : "outline"}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setPickedId(e.id);
                            }}
                          >
                            {isPicked ? "Selected" : "Pick"}
                          </Button>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {picked && (
        <div className="rounded-md border p-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Compensating entry that will be written
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Kind</div>
              <div>{picked.kind}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">User</div>
              <div className="font-mono text-xs">{picked.userId}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Original amount</div>
              <div className="tabular-nums">
                {picked.currency} {picked.amount.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Compensating amount</div>
              <div className="tabular-nums text-red-700 dark:text-red-300">
                {picked.currency} {(-picked.amount).toLocaleString()}
              </div>
            </div>
          </div>
          {picked.kind === "payout" && (
            <label
              className="mt-3 flex cursor-pointer items-center gap-2 text-sm"
              onClick={() => setClearPayout((v) => !v)}
            >
              <Checkbox checked={clearPayout} tabIndex={-1} />
              Also clear the recipient&apos;s payoutCycle so the slot can be re-awarded.
            </label>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="reason">Reason (required, saved to audit log)</Label>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this entry being reversed? e.g. duplicate contribution recorded by admin at 14:03."
          rows={3}
        />
      </div>

      <Button
        variant="default"
        disabled={!canApply || busy}
        onClick={apply}
      >
        <RotateCcw />
        {busy ? "Recording reversal…" : "Record reversal"}
      </Button>
    </div>
  );
}
