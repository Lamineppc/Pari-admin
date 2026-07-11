"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Inbox, Search } from "lucide-react";
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
import {
  subscribeTickets,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support";
import { NewTicketDialog } from "./new-ticket-dialog";
import { TicketDetailSheet } from "./ticket-detail-sheet";

const STATUS_FILTERS: Array<{ key: TicketStatus | "all"; label: string }> = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
  normal: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  high: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  urgent: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  closed: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

export default function SupportPage() {
  const PAGE_SIZE = 15;
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    const unsub = subscribeTickets(setTickets, (e) => {
      toast.error(e.message);
      setTickets([]);
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    if (!tickets) return null;
    const needle = q.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        t.subject.toLowerCase().includes(needle) ||
        t.body.toLowerCase().includes(needle) ||
        t.userName.toLowerCase().includes(needle) ||
        t.userEmail.toLowerCase().includes(needle) ||
        t.userId.toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle) ||
        (t.groupId?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tickets, statusFilter, q]);

  const counts = useMemo(() => {
    const c: Record<TicketStatus | "all", number> = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
      all: 0,
    };
    for (const t of tickets ?? []) {
      c.all++;
      c[t.status]++;
    }
    return c;
  }, [tickets]);

  const selected = useMemo(
    () => tickets?.find((t) => t.id === selectedId) ?? null,
    [tickets, selectedId],
  );

  const totalPages = filtered ? Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)) : 1;
  useEffect(() => {
    if (page > totalPages - 1) setPage(0);
  }, [page, totalPages]);
  useEffect(() => {
    setPage(0);
  }, [statusFilter, q]);

  const pagedFiltered = useMemo(() => {
    if (!filtered) return null;
    const start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Inbox className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
            <p className="text-sm text-muted-foreground">
              User-reported issues. Reply, add internal notes, and resolve
              tickets. Replies land in the user&apos;s in-app inbox.
            </p>
          </div>
          <NewTicketDialog />
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={statusFilter === f.key ? "default" : "outline"}
              onClick={() => setStatusFilter(f.key)}
            >
              {f.label}
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {counts[f.key]}
              </Badge>
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-1">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search subject / body / user / category…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Updated</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedFiltered === null && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {pagedFiltered !== null && pagedFiltered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  No tickets match the current filters.
                </TableCell>
              </TableRow>
            )}
            {pagedFiltered?.map((t) => (
              <TableRow
                key={t.id}
                className="cursor-pointer"
                onClick={() => setSelectedId(t.id)}
              >
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {t.updatedAt?.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }) ?? "—"}
                </TableCell>
                <TableCell className="max-w-xs truncate text-sm font-medium" title={t.subject}>
                  {t.subject || "(no subject)"}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex flex-col">
                    <span>{t.userName || t.userEmail || "—"}</span>
                    <span
                      className="truncate font-mono text-[10px] text-muted-foreground"
                      title={t.userId}
                    >
                      {t.userId.length > 16 ? `${t.userId.slice(0, 16)}…` : t.userId}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    {t.category}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${PRIORITY_STYLES[t.priority]}`}>
                    {t.priority}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${STATUS_STYLES[t.status]}`}>
                    {t.status.replace("_", " ")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered && filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft /> Prev
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              Page {page + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next <ChevronRight />
            </Button>
          </div>
        </div>
      )}

      <TicketDetailSheet
        ticket={selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </div>
  );
}
