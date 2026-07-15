"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Search, UserX } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeKicks, type KickRecord } from "@/lib/kicks";
import { subscribeGroups, type Group } from "@/lib/groups";

export default function KicksPage() {
  const router = useRouter();
  const [kicks, setKicks] = useState<KickRecord[] | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [q, setQ] = useState("");
  const [hideSim, setHideSim] = useState(false);

  useEffect(() => {
    const unsubK = subscribeKicks(
      setKicks,
      300,
      (e) => {
        toast.error(e.message);
        setKicks([]);
      },
    );
    const unsubG = subscribeGroups(setGroups, () => setGroups([]));
    return () => {
      unsubK();
      unsubG();
    };
  }, []);

  const groupMap = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groups ?? []) m.set(g.id, g);
    return m;
  }, [groups]);

  const filtered = useMemo(() => {
    if (!kicks) return null;
    const needle = q.trim().toLowerCase();
    return kicks.filter((k) => {
      const g = groupMap.get(k.groupId);
      if (hideSim && g?.moneyProvider === "mock") return false;
      if (!needle) return true;
      return (
        k.userName.toLowerCase().includes(needle) ||
        k.userId.toLowerCase().includes(needle) ||
        k.groupId.toLowerCase().includes(needle) ||
        (g?.name.toLowerCase().includes(needle) ?? false) ||
        (k.kickReason?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [kicks, q, hideSim, groupMap]);

  const stats = useMemo(() => {
    if (!filtered) return null;
    return {
      total: filtered.length,
      refunded: filtered.reduce((a, k) => a + k.refundAmount, 0),
      unique: new Set(filtered.map((k) => k.userId)).size,
    };
  }, [filtered]);

  function exportCsv() {
    if (!filtered) return;
    const cols = [
      "kickedAt",
      "groupId",
      "groupName",
      "userId",
      "userName",
      "role",
      "position",
      "refundAmount",
      "currency",
      "reason",
    ];
    const rows = filtered.map((k) => {
      const g = groupMap.get(k.groupId);
      return [
        k.kickedAt?.toISOString() ?? "",
        k.groupId,
        g?.name ?? "",
        k.userId,
        k.userName,
        k.role,
        k.position ?? "",
        k.refundAmount,
        g?.currency ?? "CFA",
        k.kickReason ?? "",
      ];
    });
    const csv = [cols, ...rows]
      .map((r) =>
        r
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kicks_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <UserX className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Kicks + refunds
            </h1>
            <p className="text-sm text-muted-foreground">
              Every kicked member across every group. Read-only — corrections
              go through the group&apos;s admin flow so the ledger stays
              consistent. Click a row to jump to the group.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!filtered || filtered.length === 0}
          >
            <Download /> Export CSV
          </Button>
        </div>
        <div className="flex gap-3 pt-2">
          <StatCard label="Kicks" value={stats?.total ?? 0} />
          <StatCard label="Unique members" value={stats?.unique ?? 0} />
          <StatCard
            label="Total refunded"
            value={stats?.refunded ?? 0}
            money
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search group / member / uid / reason…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setHideSim((v) => !v)}
          >
            <Checkbox checked={hideSim} tabIndex={-1} />
            Hide simulation groups
          </label>
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Pos</TableHead>
              <TableHead className="text-right">Refund</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  No kicks match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((k) => {
              const g = groupMap.get(k.groupId);
              const currency = g?.currency ?? "CFA";
              return (
                <TableRow
                  key={`${k.groupId}:${k.id}`}
                  onClick={() => router.push(`/groups/${k.groupId}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {k.kickedAt?.toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }) ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {g?.name ?? "(deleted)"}
                      </span>
                      <span className="flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground" title={k.groupId}>
                        {k.groupId.slice(0, 14)}…
                        {g?.moneyProvider === "mock" && (
                          <Badge variant="outline" className="border-purple-200 bg-purple-50 text-[9px] text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                            sim
                          </Badge>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1">
                        {k.userName || "(no name)"}
                        {k.role !== "member" && (
                          <Badge variant="secondary" className="text-[10px]">
                            {k.role}
                          </Badge>
                        )}
                      </span>
                      <span className="truncate font-mono text-[10px] text-muted-foreground" title={k.userId}>
                        {k.userId.slice(0, 14)}…
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {k.position !== null ? `#${k.position}` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium tabular-nums">
                    {currency} {k.refundAmount.toLocaleString()}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={k.kickReason ?? ""}>
                    {k.kickReason ?? "—"}
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
  money = false,
}: {
  label: string;
  value: number;
  money?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-md border p-3 min-w-32">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">
        {money ? `CFA ${value.toLocaleString()}` : value}
      </span>
    </div>
  );
}
