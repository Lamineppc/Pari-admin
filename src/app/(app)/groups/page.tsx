"use client";

import { useEffect, useMemo, useState } from "react";
import { UsersRound, Search, ShieldPlus } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EscalationBadge } from "@/components/escalation-badge";
import { GroupDetailSheet } from "./group-detail-sheet";
import { NewMockGroupDialog } from "./new-mock-group-dialog";
import { isMockMoneyGroup, phaseLabelForCycle, subscribeGroups, type Group } from "@/lib/groups";
import { Beaker } from "lucide-react";

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        g.id.toLowerCase().includes(needle) ||
        g.createdBy.toLowerCase().includes(needle),
    );
  }, [groups, q]);

  const selected = groups?.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <UsersRound className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <p className="text-sm text-muted-foreground">
              Live view of every tontine on the platform. Click a row for details and actions.
            </p>
          </div>
          <NewMockGroupDialog onCreated={(id) => setSelectedId(id)} />
        </div>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, id, or admin uid…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cycle</TableHead>
              <TableHead className="text-right">Members</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && <LoadingRows />}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  {q ? "No groups match your search." : "No groups yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((g) => {
              const current = g.currentCycle ?? 0;
              const phaseLabel = phaseLabelForCycle(g, current);
              return (
                <TableRow
                  key={g.id}
                  onClick={() => setSelectedId(g.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{g.name || "(untitled)"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Badge variant={g.type === "secured" ? "default" : "secondary"}>
                        {g.type}
                      </Badge>
                      {isMockMoneyGroup(g) && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200"
                          title="Simulation group — no real money"
                        >
                          <Beaker className="h-2.5 w-2.5" />
                          sim
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.status === "active" ? "secondary" : "outline"}>
                      {g.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.type === "secured"
                      ? current > 0
                        ? `${phaseLabel} · ${current}/${g.memberCount}`
                        : `Not started · 0/${g.memberCount}`
                      : current > 0
                        ? `${current}/${g.memberCount}`
                        : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.memberCount}</TableCell>
                  <TableCell>
                    {g.adminEscalationFlag ? (
                      <EscalationBadge flag={g.adminEscalationFlag} />
                    ) : g.caretakerBy ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                        <ShieldPlus className="h-3 w-3" /> Caretaker
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <GroupDetailSheet group={selected} onOpenChange={(o) => !o && setSelectedId(null)} />
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={6}>
            <Skeleton className="h-6 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
