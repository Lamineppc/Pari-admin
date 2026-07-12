"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Store, Search, CheckCircle2, ShieldOff, XCircle } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { StoreDetailSheet } from "./store-detail-sheet";
import { StoreStatusBadge } from "./store-status-badge";
import { approveStore, rejectStore, revokeStore, subscribeStores, type Store as StoreDoc, type StoreStatus } from "@/lib/stores";
import { BulkActionBar } from "@/components/bulk-action-bar";

type Filter = "pending" | "active" | "suspended" | "rejected" | "all";

const FILTER_LABELS: Record<Filter, string> = {
  pending: "Pending",
  active: "Active",
  suspended: "Suspended",
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
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const unsub = subscribeStores(setStores, (e) => {
      toast.error(e.message);
      setStores([]);
    });
    return unsub;
  }, []);

  // Deep-link support for global search.
  useEffect(() => {
    const sel = searchParams.get("selected");
    if (sel) setSelectedId(sel);
  }, [searchParams]);

  const counts = useMemo(() => {
    if (!stores) return null;
    return {
      pending: stores.filter((s) => s.status === "pending").length,
      active: stores.filter((s) => s.status === "active").length,
      suspended: stores.filter((s) => s.status === "suspended").length,
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
  const allVisibleChecked =
    filtered !== null && filtered.length > 0 && filtered.every((s) => checkedIds.has(s.id));

  function toggleOne(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    if (!filtered) return;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) {
        for (const s of filtered) next.delete(s.id);
      } else {
        for (const s of filtered) next.add(s.id);
      }
      return next;
    });
  }

  async function runBulk(kind: "approve" | "reject" | "revoke") {
    if (!stores) return;
    const targets = stores.filter((s) => checkedIds.has(s.id));
    if (targets.length === 0) return;

    // Guard: don't try to approve a non-pending store or revoke a non-active
    // one — the underlying rule would allow it but the semantic is wrong.
    const eligible = targets.filter((s) => {
      if (kind === "approve") return s.status === "pending" || s.status === "rejected" || s.status === "revoked";
      if (kind === "reject") return s.status === "pending";
      return s.status === "active"; // revoke
    });
    if (eligible.length === 0) {
      toast.error(`No stores in the selection are eligible for ${kind}.`);
      return;
    }

    let reason = "";
    if (kind !== "approve") {
      reason = window.prompt(`Reason for ${kind} (sent to each owner)?`) ?? "";
      if (reason === null) return; // cancelled
    }
    if (!window.confirm(`${kind[0].toUpperCase() + kind.slice(1)} ${eligible.length} store(s)?`)) return;

    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      eligible.map(async (s) => {
        try {
          if (kind === "approve") await approveStore(s);
          else if (kind === "reject") await rejectStore(s, reason);
          else await revokeStore(s, reason);
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBusy(false);
    setCheckedIds(new Set());
    const skipped = targets.length - eligible.length;
    toast.success(
      `${kind} applied to ${ok}${failed > 0 ? `, ${failed} failed` : ""}${skipped > 0 ? `, ${skipped} skipped as ineligible` : ""}.`,
    );
  }

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
          {(["pending", "active", "suspended", "rejected", "all"] as Filter[]).map((f) => (
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
              <TableHead className="w-8">
                <div
                  role="checkbox"
                  aria-checked={allVisibleChecked}
                  tabIndex={0}
                  onClick={toggleAllVisible}
                  className="inline-flex cursor-pointer items-center justify-center"
                >
                  <Checkbox checked={allVisibleChecked} tabIndex={-1} />
                </div>
              </TableHead>
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
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  {q ? "No applications match your search." : "No applications in this bucket."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((s) => {
              const isChecked = checkedIds.has(s.id);
              return (
                <TableRow
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className="cursor-pointer"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div
                      role="checkbox"
                      aria-checked={isChecked}
                      tabIndex={0}
                      onClick={() => toggleOne(s.id)}
                      className="inline-flex cursor-pointer items-center justify-center"
                    >
                      <Checkbox checked={isChecked} tabIndex={-1} />
                    </div>
                  </TableCell>
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
              );
            })}
          </TableBody>
        </Table>
      </div>

      <StoreDetailSheet
        store={selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />

      <BulkActionBar count={checkedIds.size} onClear={() => setCheckedIds(new Set())}>
        <Button variant="default" size="sm" disabled={busy} onClick={() => runBulk("approve")}>
          <CheckCircle2 /> Approve
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => runBulk("reject")}>
          <XCircle /> Reject
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => runBulk("revoke")}>
          <ShieldOff /> Revoke
        </Button>
      </BulkActionBar>
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
