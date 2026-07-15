"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EscalationBadge } from "@/components/escalation-badge";
import {
  isMockMoneyGroup,
  phaseLabelForCycle,
  subscribeGroups,
  type Group,
} from "@/lib/groups";

type SortKey = "age" | "money" | "size";

function fmtAge(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function moneyAtRisk(g: Group): number {
  // Rough proxy: contribution × memberCount × currentCycle. Actual pot
  // balance requires a wallet lookup — good enough for sorting.
  return g.amount * g.memberCount * Math.max(g.currentCycle ?? 0, 1);
}

export default function EscalationsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("age");

  useEffect(() => {
    const unsub = subscribeGroups(setGroups, (e) => {
      toast.error(e.message);
      setGroups([]);
    });
    return unsub;
  }, []);

  const escalated = useMemo(() => {
    if (!groups) return null;
    const filtered = groups.filter(
      (g) => g.adminEscalationFlag !== null || g.caretakerBy !== null,
    );
    filtered.sort((a, b) => {
      if (sortBy === "age") {
        const at = a.adminEscalationFlaggedAt?.getTime() ?? 0;
        const bt = b.adminEscalationFlaggedAt?.getTime() ?? 0;
        return at - bt; // oldest first
      }
      if (sortBy === "money") return moneyAtRisk(b) - moneyAtRisk(a);
      return b.memberCount - a.memberCount;
    });
    return filtered;
  }, [groups, sortBy]);

  const activeFlags = escalated?.filter((g) => g.adminEscalationFlag !== null).length ?? 0;
  const caretakers = escalated?.filter((g) => g.caretakerBy !== null).length ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Escalations</h1>
            <p className="text-sm text-muted-foreground">
              Every group needing super-admin attention — active escalation
              flags plus groups currently under caretaker admin. Click any row
              for the intervention actions.
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <StatCard label="Active flags" value={activeFlags} tone="red" />
          <StatCard label="Under caretaker" value={caretakers} tone="blue" />
        </div>
      </header>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Sort:</span>
        <SortToggle current={sortBy} onSet={setSortBy} value="age" label="Oldest first" />
        <SortToggle current={sortBy} onSet={setSortBy} value="money" label="Money at risk" />
        <SortToggle current={sortBy} onSet={setSortBy} value="size" label="Group size" />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Flag</TableHead>
              <TableHead>Phase / cycle</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead className="text-right">Est. money</TableHead>
              <TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {escalated === null && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {escalated !== null && escalated.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  Nothing to escalate — no flagged groups and no caretakers.
                </TableCell>
              </TableRow>
            )}
            {escalated?.map((g) => {
              const current = g.currentCycle ?? 0;
              return (
                <TableRow
                  key={g.id}
                  onClick={() => router.push(`/groups/${g.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1.5">
                      <span>{g.name}</span>
                      {isMockMoneyGroup(g) && (
                        <span className="rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                          sim
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {g.adminEscalationFlag ? (
                      <EscalationBadge flag={g.adminEscalationFlag} />
                    ) : g.caretakerBy ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                        <ShieldPlus className="h-3 w-3" /> Caretaker
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {phaseLabelForCycle(g, current)} · {current}/{g.memberCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.memberCount}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {g.currency} {moneyAtRisk(g).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtAge(g.adminEscalationFlaggedAt)}
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

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "blue";
}) {
  const cls =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200";
  return (
    <div className={`flex flex-col rounded-md border p-3 min-w-32 ${cls}`}>
      <span className="text-xs uppercase tracking-wide opacity-75">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function SortToggle({
  current,
  value,
  label,
  onSet,
}: {
  current: SortKey;
  value: SortKey;
  label: string;
  onSet: (v: SortKey) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSet(value)}
      className={
        active
          ? "rounded-md bg-primary/10 px-2 py-1 font-medium text-primary"
          : "rounded-md px-2 py-1 hover:bg-muted"
      }
    >
      {label}
    </button>
  );
}
