"use client";

import { useEffect, useMemo, useState } from "react";
import { UsersRound, Search } from "lucide-react";
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
import { securedPhase, subscribeGroups, type Group } from "@/lib/groups";

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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
            <p className="text-sm text-muted-foreground">
              Live view of every tontine on the platform. Click a row for details and actions.
            </p>
          </div>
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
              const phase = securedPhase(g);
              return (
                <TableRow
                  key={g.id}
                  onClick={() => setSelectedId(g.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{g.name || "(untitled)"}</TableCell>
                  <TableCell>
                    <Badge variant={g.type === "secured" ? "default" : "secondary"}>
                      {g.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={g.status === "active" ? "secondary" : "outline"}>
                      {g.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {g.type === "secured"
                      ? `${phase}${g.currentCycle ? ` · ${g.currentCycle}/${g.memberCount}` : ""}`
                      : g.currentCycle
                        ? `${g.currentCycle}/${g.memberCount}`
                        : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{g.memberCount}</TableCell>
                  <TableCell>
                    {g.adminEscalationFlag ? (
                      <EscalationBadge flag={g.adminEscalationFlag} />
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
