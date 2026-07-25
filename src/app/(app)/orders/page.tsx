"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, Percent, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  setMarketplaceFeePercent,
  subscribeMarketplaceConfig,
} from "@/lib/platform-config";
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
import {
  isPayoutReady,
  itemsSubtotal,
  subscribeOrders,
  type MarketplaceOrder,
  type OrderStatus,
} from "@/lib/orders";

type Filter =
  | "all"
  | "payout_due"
  | "awaiting_quote"
  | "quoted"
  | "paid"
  | "awaiting_pickup"
  | "in_transit"
  | "delivered"
  | "paid_out"
  | "cancelled"
  | "refunded";

function statusLabel(s: OrderStatus): string {
  switch (s) {
    case "awaiting_quote":
      return "Awaiting quote";
    case "quoted":
      return "Quoted";
    case "paid":
      return "Paid";
    case "awaiting_pickup":
      return "Awaiting pickup";
    case "in_transit":
      return "In transit";
    case "delivered":
      return "Delivered";
    case "paid_out":
      return "Paid out";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
  }
}

function statusTone(s: OrderStatus): string {
  switch (s) {
    case "awaiting_quote":
      return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900";
    case "quoted":
      return "bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900";
    case "paid":
      return "bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-200 dark:border-purple-900";
    case "awaiting_pickup":
      return "bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-900";
    case "in_transit":
      return "bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-900";
    case "delivered":
    case "paid_out":
      return "bg-green-50 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900";
    case "cancelled":
    case "refunded":
      return "bg-red-50 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900";
  }
}

function fmtAge(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "<1h";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function OrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<MarketplaceOrder[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [feePct, setFeePct] = useState<number | null>(null);

  useEffect(() => subscribeMarketplaceConfig((cfg) => setFeePct(cfg.feePercent)), []);

  const searchParams = useSearchParams();
  useEffect(() => {
    const f = searchParams.get("filter");
    if (!f) return;
    const known: Filter[] = [
      "all",
      "payout_due",
      "awaiting_quote",
      "quoted",
      "paid",
      "awaiting_pickup",
      "in_transit",
      "delivered",
      "paid_out",
      "cancelled",
      "refunded",
    ];
    if (known.includes(f as Filter)) setFilter(f as Filter);
  }, [searchParams]);

  useEffect(() => {
    const unsub = subscribeOrders(setOrders, (e) => {
      toast.error(e.message);
      setOrders([]);
    });
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    if (!orders) return null;
    let byStatus: MarketplaceOrder[];
    if (filter === "all") {
      byStatus = orders;
    } else if (filter === "payout_due") {
      byStatus = orders.filter(isPayoutReady);
    } else {
      byStatus = orders.filter((o) => o.status === filter);
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return byStatus;
    return byStatus.filter(
      (o) =>
        o.id.toLowerCase().includes(needle) ||
        o.buyerName.toLowerCase().includes(needle) ||
        o.buyerId.toLowerCase().includes(needle) ||
        o.lines.some((l) => l.title.toLowerCase().includes(needle)),
    );
  }, [orders, filter, q]);

  const counts = useMemo(() => {
    if (!orders) return {} as Record<Filter, number>;
    const out: Record<string, number> = { all: orders.length };
    for (const o of orders) out[o.status] = (out[o.status] ?? 0) + 1;
    out.payout_due = orders.filter(isPayoutReady).length;
    return out as Record<Filter, number>;
  }, [orders]);

  const chips: Filter[] = [
    "all",
    "payout_due",
    "awaiting_quote",
    "quoted",
    "paid",
    "awaiting_pickup",
    "in_transit",
    "delivered",
    "paid_out",
    "cancelled",
    "refunded",
  ];

  function chipLabel(c: Filter): string {
    if (c === "all") return "All";
    if (c === "payout_due") return "Payout due";
    return statusLabel(c as OrderStatus);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Package className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
            <p className="text-sm text-muted-foreground">
              Every marketplace order in flight. Quote delivery, assign a courier,
              generate the PIN, or issue a refund.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const raw = window.prompt(
                "Marketplace platform fee % (deducted from seller on payout):",
                feePct != null ? String(feePct) : "10",
              );
              if (raw === null) return;
              const n = Number(raw);
              try {
                await setMarketplaceFeePercent(n);
                toast.success(`Marketplace fee set to ${n}%.`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Update failed.");
              }
            }}
          >
            <Percent className="mr-1 h-4 w-4" />
            Fee {feePct != null ? `${feePct}%` : "…"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-1 text-xs">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={
                "rounded-full border px-3 py-1 " +
                (filter === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted")
              }
            >
              {chipLabel(c)}
              <span className="ml-1 text-[10px] opacity-70">
                {counts[c] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="max-w-sm">
          <Input
            placeholder="Search by order id, buyer name, or item…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Items</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
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
                  {q ? "No orders match." : "No orders yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((o) => {
              const amount = o.deliveryFee != null
                ? itemsSubtotal(o) + o.deliveryFee
                : itemsSubtotal(o);
              const firstLine = o.lines[0];
              return (
                <TableRow
                  key={o.id}
                  onClick={() => router.push(`/orders/${o.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-mono text-xs">
                    {o.id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-sm">{o.buyerName || o.buyerId.slice(0, 8)}</TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {firstLine
                      ? o.lines.length === 1
                        ? `${firstLine.quantity} × ${firstLine.title}`
                        : `${firstLine.title} +${o.lines.length - 1} more`
                      : "(empty)"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {o.currency} {amount.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={statusTone(o.status)}
                    >
                      {o.status === "in_transit" && (
                        <Truck className="mr-1 h-3 w-3 inline" />
                      )}
                      {statusLabel(o.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtAge(o.createdAt)}
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
