"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Search, Download } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  subscribeAuditLog,
  type AuditEntry,
} from "@/lib/audit";

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [q, setQ] = useState("");
  const [hideTest, setHideTest] = useState(false);
  const [hidePrelaunch, setHidePrelaunch] = useState(false);

  useEffect(() => {
    const unsub = subscribeAuditLog(
      setEntries,
      { max: 500, hideTest, hidePrelaunch },
      (e) => {
        toast.error(e.message);
        setEntries([]);
      },
    );
    return unsub;
  }, [hideTest, hidePrelaunch]);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (e) =>
        e.actorEmail.toLowerCase().includes(needle) ||
        e.actorUid.toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle) ||
        e.targetId.toLowerCase().includes(needle) ||
        (e.reason ?? "").toLowerCase().includes(needle),
    );
  }, [entries, q]);

  function exportCsv() {
    if (!filtered) return;
    const cols = [
      "timestamp",
      "actorUid",
      "actorEmail",
      "action",
      "targetType",
      "targetId",
      "test",
      "phase",
      "reason",
      "before",
      "after",
      "metadata",
    ];
    const rows = filtered.map((e) => [
      e.createdAt?.toISOString() ?? "",
      e.actorUid,
      e.actorEmail,
      e.action,
      e.targetType,
      e.targetId,
      String(e.test),
      e.phase,
      e.reason ?? "",
      JSON.stringify(e.before ?? {}),
      JSON.stringify(e.after ?? {}),
      JSON.stringify(e.metadata ?? {}),
    ]);
    const csv = [cols, ...rows]
      .map((r) =>
        r
          .map((v) => {
            const s = String(v ?? "").replace(/"/g, '""');
            return `"${s}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <FileText className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
            <p className="text-sm text-muted-foreground">
              Append-only record of every consequential super-admin action.
              Tamper-evident — Firestore rules block update and delete. Toggle
              filters below to hide test/simulation entries for a regulator
              export.
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
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search actor / action / target / reason…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setHideTest((v) => !v)}
          >
            <Checkbox checked={hideTest} tabIndex={-1} />
            Hide test actions
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setHidePrelaunch((v) => !v)}
          >
            <Checkbox checked={hidePrelaunch} tabIndex={-1} />
            Live only (hide prelaunch)
          </label>
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Flags</TableHead>
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
                  No entries match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {e.createdAt?.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }) ?? "—"}
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    <span>{e.actorEmail || "(no email)"}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground" title={e.actorUid}>
                      {e.actorUid.slice(0, 16)}…
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {e.action}
                </TableCell>
                <TableCell className="text-sm">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">{e.targetType}</span>
                    <span className="truncate font-mono text-[10px]" title={e.targetId}>
                      {e.targetId.length > 20 ? `${e.targetId.slice(0, 20)}…` : e.targetId}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {e.reason ?? "—"}
                </TableCell>
                <TableCell className="text-xs">
                  {e.test && (
                    <Badge variant="outline" className="mr-1 border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                      test
                    </Badge>
                  )}
                  {e.phase === "prelaunch" && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      prelaunch
                    </Badge>
                  )}
                  {e.phase === "live" && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                      live
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
