"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive as ArchiveIcon } from "lucide-react";
import { toast } from "sonner";
import {
  subscribeAllArchive,
  type ArchiveTargetType,
  type EscalationArchiveEntry,
} from "@/lib/escalation-archive";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type Filter = "all" | ArchiveTargetType;

function detailHref(e: EscalationArchiveEntry): string | null {
  if (e.targetType === "user") return `/users/${e.targetId}`;
  if (e.targetType === "group") return `/groups/${e.targetId}`;
  return null; // stores open via sheet — no standalone route
}

export default function EscalationArchivePage() {
  const [entries, setEntries] = useState<EscalationArchiveEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    const unsub = subscribeAllArchive(setEntries, (e) => {
      toast.error(e.message);
      setEntries([]);
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const byKind =
      filter === "all" ? entries : entries.filter((e) => e.targetType === filter);
    const needle = q.trim().toLowerCase();
    if (!needle) return byKind;
    return byKind.filter(
      (e) =>
        e.targetName.toLowerCase().includes(needle) ||
        e.targetId.toLowerCase().includes(needle) ||
        (e.reason?.toLowerCase().includes(needle) ?? false) ||
        (e.dismissNote?.toLowerCase().includes(needle) ?? false) ||
        e.flag.toLowerCase().includes(needle),
    );
  }, [entries, filter, q]);

  const counts = useMemo(() => {
    if (!entries)
      return { all: 0, user: 0, group: 0, store: 0 } as Record<Filter, number>;
    return {
      all: entries.length,
      user: entries.filter((e) => e.targetType === "user").length,
      group: entries.filter((e) => e.targetType === "group").length,
      store: entries.filter((e) => e.targetType === "store").length,
    };
  }, [entries]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Link
            href="/escalations"
            className="flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted"
            title="Back to escalations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <ArchiveIcon className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Complaint archive
            </h1>
            <p className="text-sm text-muted-foreground">
              Every dismissed escalation across users, groups, and stores.
              Append-only.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2 text-xs">
          {(
            [
              ["all", "All"],
              ["user", "Users"],
              ["group", "Groups"],
              ["store", "Stores"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={
                "rounded-full border px-3 py-1 " +
                (filter === key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted")
              }
            >
              {label}
              <span className="ml-1 text-[10px] opacity-70">{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="max-w-sm">
          <Input
            placeholder="Search name, reason, note…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Target</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Flag</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Dismissed</TableHead>
              <TableHead>By</TableHead>
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
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {q ? "No matches." : "Nothing archived yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((e) => {
              const href = detailHref(e);
              const rowCls = href
                ? "cursor-pointer"
                : "";
              return (
                <TableRow
                  key={e.id}
                  className={rowCls}
                  onClick={() => {
                    if (href) window.location.href = href;
                  }}
                >
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{e.targetName || e.targetId}</span>
                      {e.targetSecondary && (
                        <span className="text-[11px] text-muted-foreground">
                          {e.targetSecondary}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">
                    {e.targetType}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                    >
                      {e.flag.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-md text-sm text-muted-foreground">
                    <div className="line-clamp-2 whitespace-pre-wrap">
                      {e.reason || "—"}
                    </div>
                    {e.dismissNote?.trim() && (
                      <div className="mt-1 line-clamp-2 whitespace-pre-wrap text-[11px] italic">
                        note: {e.dismissNote}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.dismissedAt?.toLocaleString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.dismissedByEmail || e.dismissedBy || "—"}
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
