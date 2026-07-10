"use client";

import { useEffect, useMemo, useState } from "react";
import { Store, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StoreDetailSheet } from "./store-detail-sheet";
import { StoreStatusBadge } from "./store-status-badge";
import { subscribeStores, type Store as StoreDoc, type StoreStatus } from "@/lib/stores";

type Filter = "pending" | "active" | "rejected" | "all";

const FILTER_LABELS: Record<Filter, string> = {
  pending: "Pending",
  active: "Active",
  rejected: "Rejected & revoked",
  all: "All",
};

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function matchesFilter(status: StoreStatus, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "rejected") return status === "rejected" || status === "revoked";
  return status === filter;
}

export default function StoreApplicationsPage() {
  const [stores, setStores] = useState<StoreDoc[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeStores(setStores, (e) => {
      toast.error(e.message);
      setStores([]);
    });
    return unsub;
  }, []);

  const counts = useMemo(() => {
    if (!stores) return null;
    return {
      pending: stores.filter((s) => s.status === "pending").length,
      active: stores.filter((s) => s.status === "active").length,
      rejected: stores.filter((s) => s.status === "rejected" || s.status === "revoked").length,
      all: stores.length,
    } as Record<Filter, number>;
  }, [stores]);

  const filtered = useMemo(() => {
    if (!stores) return null;
    const needle = q.trim().toLowerCase();
    return stores.filter((s) => {
      if (!matchesFilter(s.status, filter)) return false;
      if (!needle) return true;
      return (
        s.storeName.toLowerCase().includes(needle) ||
        s.ownerName.toLowerCase().includes(needle) ||
        s.ownerId.toLowerCase().includes(needle) ||
        s.category.toLowerCase().includes(needle)
      );
    });
  }, [stores, q, filter]);

  const selected = stores?.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Store className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Store applications</h1>
            <p className="text-sm text-muted-foreground">
              Approve, reject, or revoke marketplace vendors. Click a row for details.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["pending", "active", "rejected", "all"] as Filter[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
              {counts && (
                <span
                  className={
                    filter === f
                      ? "ml-2 text-xs opacity-90"
                      : "ml-2 text-xs text-muted-foreground"
                  }
                >
                  {counts[f]}
                </span>
              )}
            </Button>
          ))}
        </div>

        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by store, owner, category, or uid…"
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
              <TableHead>Store</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Applied</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && <LoadingRows />}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  {q ? "No applications match your search." : "No applications in this bucket."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((s) => (
              <TableRow
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className="cursor-pointer"
              >
                <TableCell className="font-medium">{s.storeName || "(no name)"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {s.ownerName || "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{s.category}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {fmtDate(s.createdAt)}
                </TableCell>
                <TableCell>
                  <StoreStatusBadge status={s.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <StoreDetailSheet
        store={selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={5}>
            <Skeleton className="h-6 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
