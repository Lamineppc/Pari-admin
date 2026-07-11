"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, Search, Wrench } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeGroups, type Group } from "@/lib/groups";
import { loadCyclePayments, wipeCycleData, type PaymentModel } from "@/lib/cycle-correction";

export default function CycleCorrectionPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Group | null>(null);
  const [cycle, setCycle] = useState<number | null>(null);
  const [payments, setPayments] = useState<PaymentModel[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
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

  useEffect(() => {
    if (step !== 2 || !selected || cycle == null) return;
    setPayments(null);
    loadCyclePayments(selected.id, cycle).then(setPayments).catch((e) => {
      toast.error(e instanceof Error ? e.message : String(e));
      setPayments([]);
    });
  }, [step, selected, cycle]);

  function reset() {
    setStep(0);
    setSelected(null);
    setCycle(null);
    setPayments(null);
    setConfirmText("");
  }

  function back() {
    if (step === 2) {
      setStep(1);
      setCycle(null);
      setPayments(null);
      setConfirmText("");
    } else if (step === 1) {
      setStep(0);
      setSelected(null);
    }
  }

  async function apply() {
    if (!selected || cycle == null) return;
    setBusy(true);
    try {
      const r = await wipeCycleData(selected.id, cycle);
      toast.success(
        `Wiped ${r.paymentsDeleted} payment(s) and unpaid ${r.membersUnpaid} member(s). currentCycle reset to ${cycle}.`,
      );
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
              Wipe every payment record for a specific cycle, unpay any
              members marked paid that cycle, and roll the group back to
              that cycle number. Irreversible — use only when a rotation
              is broken and needs a manual reset.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <StepIndicator active={step === 0} completed={step > 0} label="1 · Pick group" />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator active={step === 1} completed={step > 1} label="2 · Pick cycle" />
          <ChevronRight className="h-3 w-3" />
          <StepIndicator active={step === 2} completed={false} label="3 · Confirm + wipe" />
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
          onPick={(g) => {
            setSelected(g);
            setStep(1);
          }}
        />
      )}

      {step === 1 && selected && (
        <CycleStep
          group={selected}
          onPick={(c) => {
            setCycle(c);
            setStep(2);
          }}
        />
      )}

      {step === 2 && selected && cycle != null && (
        <ConfirmStep
          group={selected}
          cycle={cycle}
          payments={payments}
          confirmText={confirmText}
          onConfirmText={setConfirmText}
          busy={busy}
          onApply={apply}
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
  onPick: (g: Group) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
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
              <TableHead className="text-right">Members</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups === null && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {groups?.map((g) => (
              <TableRow
                key={g.id}
                onClick={() => onPick(g)}
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
                <TableCell className="text-right tabular-nums">
                  {g.memberCount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function CycleStep({
  group,
  onPick,
}: {
  group: Group;
  onPick: (n: number) => void;
}) {
  const current = group.currentCycle ?? 0;
  const cycles = Array.from({ length: Math.max(current, 1) }, (_, i) => i + 1);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Pick which cycle to wipe on <span className="font-medium">{group.name}</span>.
        Wiping cycle N deletes every payment record with cycleNumber == N and
        resets group.currentCycle back to N. That means cycles N+1 and later
        (if any) will also effectively be forgotten until fresh payments get
        recorded.
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

function ConfirmStep({
  group,
  cycle,
  payments,
  confirmText,
  onConfirmText,
  busy,
  onApply,
}: {
  group: Group;
  cycle: number;
  payments: PaymentModel[] | null;
  confirmText: string;
  onConfirmText: (v: string) => void;
  busy: boolean;
  onApply: () => void;
}) {
  const expected = `${group.name} cycle ${cycle}`;
  const canConfirm = confirmText.trim() === expected;
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
          onChange={(e) => onConfirmText(e.target.value)}
          placeholder={expected}
        />
      </div>

      <Button
        variant="destructive"
        disabled={!canConfirm || busy}
        onClick={onApply}
      >
        {busy ? "Wiping…" : `Wipe cycle ${cycle} on ${group.name}`}
      </Button>
    </div>
  );
}
