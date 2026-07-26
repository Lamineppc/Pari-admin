"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban, Copy, KeyRound, Truck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  assignCourierAndIssuePin,
  cancelOrder,
  isPayoutReady,
  itemsSubtotal,
  listCouriers,
  payOutOrderToSeller,
  quoteOrder,
  refundOrder,
  subscribeOrder,
  subscribeOrderPins,
  type CourierCandidate,
  type MarketplaceOrder,
  type OrderStatus,
} from "@/lib/orders";

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

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleString() : "—";
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;
  const [order, setOrder] = useState<MarketplaceOrder | null | undefined>(
    undefined,
  );
  const [pins, setPins] = useState<{
    deliveryPin: string | null;
    pickupPin: string | null;
  }>({ deliveryPin: null, pickupPin: null });

  useEffect(() => {
    if (!orderId) return;
    return subscribeOrderPins(orderId, setPins);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    const unsub = subscribeOrder(orderId, setOrder, (e) => {
      toast.error(e.message);
      setOrder(null);
    });
    return unsub;
  }, [orderId]);

  if (order === undefined) {
    return (
      <div className="mx-auto max-w-4xl">
        <Skeleton className="h-8 w-64" />
      </div>
    );
  }
  if (order === null) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted-foreground">Order not found.</p>
      </div>
    );
  }

  const subtotal = itemsSubtotal(order);
  const total = order.deliveryFee != null ? subtotal + order.deliveryFee : null;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push("/orders")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Orders
          </Button>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Order <span className="font-mono text-lg">{order.id.slice(0, 8)}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Placed {fmtDate(order.createdAt)}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            {statusLabel(order.status)}
          </Badge>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Buyer
          </div>
          <div className="mt-1">
            <Link
              href={`/users/${order.buyerId}`}
              className="text-sm font-medium hover:underline"
            >
              {order.buyerName || order.buyerId.slice(0, 8)}
            </Link>
          </div>
          <div className="mt-2 text-xs font-mono text-muted-foreground">
            {order.buyerId}
          </div>
        </div>
        <div className="rounded-md border p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Seller
          </div>
          <div className="mt-1">
            <Link
              href={`/users/${order.sellerId}`}
              className="text-sm font-medium hover:underline"
            >
              {order.lines[0]?.sellerName || order.sellerId.slice(0, 8)}
            </Link>
          </div>
          <div className="mt-2 text-xs font-mono text-muted-foreground">
            {order.sellerId}
          </div>
        </div>
      </section>

      <section className="rounded-md border">
        <div className="border-b p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Line items
          </div>
        </div>
        <div className="divide-y">
          {order.lines.map((l) => (
            <div
              key={l.listingId}
              className="flex items-center justify-between p-4 text-sm"
            >
              <div className="flex-1 truncate">
                {l.quantity} × {l.title}
              </div>
              <div className="tabular-nums">
                {order.currency} {(l.price * l.quantity).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t bg-muted/30 p-4 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Items subtotal</span>
            <span className="tabular-nums">
              {order.currency} {subtotal.toLocaleString()}
            </span>
          </div>
          {order.deliveryFee != null && (
            <div className="mt-1 flex justify-between text-muted-foreground">
              <span>Delivery fee</span>
              <span className="tabular-nums">
                {order.currency} {order.deliveryFee.toLocaleString()}
              </span>
            </div>
          )}
          {total != null && (
            <div className="mt-2 flex justify-between font-semibold">
              <span>Total</span>
              <span className="tabular-nums">
                {order.currency} {total.toLocaleString()}
              </span>
            </div>
          )}
          {order.platformFeePercent != null && (
            <div className="mt-1 text-xs text-muted-foreground">
              Platform fee at payment: {order.platformFeePercent}%
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Delivery destination
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm">
          {order.destination.description}
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          📞 {order.destination.phone}
        </div>
        {order.destination.lat != null && order.destination.lng != null && (
          <div className="mt-1 text-xs text-muted-foreground">
            <a
              className="hover:underline"
              href={`https://www.google.com/maps?q=${order.destination.lat},${order.destination.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              {order.destination.lat.toFixed(5)}, {order.destination.lng.toFixed(5)} — open in Maps
            </a>
          </div>
        )}
      </section>

      <Separator />

      {order.status === "awaiting_quote" && <QuotePanel order={order} />}
      {(order.status === "paid" ||
        order.status === "awaiting_pickup" ||
        order.status === "in_transit") && (
        <AssignCourierPanel order={order} />
      )}
      {order.status === "awaiting_pickup" && (
        <AwaitingPickupPanel order={order} pins={pins} />
      )}
      {order.status === "in_transit" && (
        <InTransitPanel order={order} pins={pins} />
      )}
      {(pins.deliveryPin || pins.pickupPin) &&
        order.status !== "awaiting_pickup" &&
        order.status !== "in_transit" && (
          <section className="rounded-md border p-4">
            <div className="mb-2 text-sm font-medium">Delivery PINs</div>
            <div className="space-y-2">
              {pins.pickupPin && (
                <PinCallout
                  title="Pickup PIN (courier ↔ seller)"
                  pin={pins.pickupPin}
                  explainer="Issued to the courier; used at pickup to release the item."
                />
              )}
              {pins.deliveryPin && (
                <PinCallout
                  title="Delivery PIN (buyer ↔ courier)"
                  pin={pins.deliveryPin}
                  explainer="Issued to the buyer; used at drop-off to close the delivery."
                />
              )}
            </div>
          </section>
        )}
      {order.status === "delivered" && <DeliveredPanel order={order} />}
      {order.status === "paid_out" && (
        <div className="rounded-md border p-4 text-sm text-muted-foreground">
          Payout completed on {fmtDate(order.paidOutAt)}.
        </div>
      )}

      {["awaiting_quote", "quoted", "paid", "awaiting_pickup", "in_transit"].includes(
        order.status,
      ) && (
        <section className="flex flex-wrap gap-2">
          {(order.status === "paid" ||
            order.status === "awaiting_pickup" ||
            order.status === "in_transit") && (
            <RefundButton orderId={order.id} />
          )}
          <CancelButton orderId={order.id} />
        </section>
      )}

      <section className="rounded-md border p-4 text-xs text-muted-foreground">
        <div className="mb-1 font-medium text-foreground">Timeline</div>
        <div>Created: {fmtDate(order.createdAt)}</div>
        <div>Quoted: {fmtDate(order.quotedAt)}</div>
        <div>Paid: {fmtDate(order.paidAt)}</div>
        <div>Awaiting pickup: {fmtDate(order.awaitingPickupAt)}</div>
        <div>In transit: {fmtDate(order.inTransitAt)}</div>
        <div>Delivered: {fmtDate(order.deliveredAt)}</div>
        <div>Paid out: {fmtDate(order.paidOutAt)}</div>
        {order.cancelledAt && <div>Cancelled: {fmtDate(order.cancelledAt)}</div>}
      </section>
    </div>
  );
}

function QuotePanel({ order }: { order: MarketplaceOrder }) {
  const [fee, setFee] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    const n = Number(fee);
    if (!Number.isFinite(n) || n < 0) {
      toast.error("Enter a non-negative delivery fee.");
      return;
    }
    setBusy(true);
    try {
      await quoteOrder(order.id, n);
      toast.success("Quote sent to buyer.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Quote failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-md border p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Quote delivery
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Decide the delivery fee based on the buyer&apos;s destination vs the
        seller&apos;s location. The buyer will get a notification with the
        quote and pay to confirm.
      </p>
      <div className="flex items-center gap-2">
        <label className="w-32 text-xs text-muted-foreground">
          Delivery fee ({order.currency})
        </label>
        <Input
          type="number"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          placeholder="1000"
        />
        <Button size="sm" disabled={busy} onClick={submit}>
          {busy ? "Sending…" : "Send quote"}
        </Button>
      </div>
    </section>
  );
}

function AssignCourierPanel({ order }: { order: MarketplaceOrder }) {
  const [couriers, setCouriers] = useState<CourierCandidate[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [issuedPins, setIssuedPins] = useState<{
    pin: string;
    pickupPin: string | null;
  } | null>(null);

  useEffect(() => {
    listCouriers()
      .then(setCouriers)
      .catch(() => setCouriers([]));
  }, []);

  async function submit() {
    if (!selected) {
      toast.error("Pick a courier.");
      return;
    }
    setBusy(true);
    try {
      const res = await assignCourierAndIssuePin(order.id, selected);
      setIssuedPins(res);
      toast.success("Courier assigned. PINs sent to buyer + courier.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Assign failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {order.courierId ? "Reassign courier" : "Assign courier + issue PIN"}
      </div>
      {order.courierId && (
        <p className="mb-2 text-xs text-muted-foreground">
          Currently assigned: <span className="font-mono">{order.courierId}</span>.{" "}
          {order.status === "in_transit"
            ? "Pickup already completed — only the delivery PIN will be reissued; status stays In transit."
            : "Both PINs will be reissued; status stays at Awaiting pickup."}
        </p>
      )}
      <p className="mb-3 text-xs text-muted-foreground">
        The buyer will receive a 6-digit PIN to hand to the courier at drop-off.
        Only the assigned courier can flip the order to delivered by entering the
        correct PIN.
      </p>
      {couriers === null ? (
        <div className="text-xs text-muted-foreground">Loading couriers…</div>
      ) : couriers.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No couriers yet — open a user&apos;s detail page and grant the courier
          role first.
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">— Pick a courier —</option>
            {couriers.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name || c.email || c.uid.slice(0, 8)}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || !selected} onClick={submit}>
            <Truck className="mr-1 h-4 w-4" />
            {busy ? "Assigning…" : "Assign + generate PIN"}
          </Button>
        </div>
      )}
      {issuedPins && (
        <div className="mt-3 space-y-2">
          <PinCallout
            title="Delivery PIN (buyer)"
            pin={issuedPins.pin}
            explainer="Buyer says this PIN to the courier at drop-off. Courier types it in-app to close the delivery."
          />
          {issuedPins.pickupPin && (
            <PinCallout
              title="Pickup PIN (courier)"
              pin={issuedPins.pickupPin}
              explainer="Courier says this PIN to the seller at pickup. Seller types it in-app to release the item."
            />
          )}
        </div>
      )}
    </section>
  );
}

function PinCallout({
  title,
  pin,
  explainer,
}: {
  title: string;
  pin: string;
  explainer: string;
}) {
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="font-mono text-2xl font-bold tracking-widest">
          {pin}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(pin);
            toast.success("PIN copied.");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">{explainer}</div>
    </div>
  );
}

function AwaitingPickupPanel({
  order,
  pins,
}: {
  order: MarketplaceOrder;
  pins: { deliveryPin: string | null; pickupPin: string | null };
}) {
  return (
    <section className="rounded-md border border-orange-200 bg-orange-50 p-4 dark:border-orange-900 dark:bg-orange-950/40">
      <div className="flex items-center gap-2">
        <Truck className="h-4 w-4 text-orange-700 dark:text-orange-300" />
        <div className="text-sm font-medium text-orange-800 dark:text-orange-200">
          Awaiting pickup
        </div>
      </div>
      <div className="mt-1 text-xs text-orange-700 dark:text-orange-300">
        Courier: <span className="font-mono">{order.courierId?.slice(0, 8)}</span>
      </div>
      <div className="mt-3 space-y-2">
        {pins.pickupPin && (
          <PinCallout
            title="Pickup PIN (courier)"
            pin={pins.pickupPin}
            explainer="Courier says this PIN to the seller at pickup. Order flips to In transit once the seller enters it in the app."
          />
        )}
        {pins.deliveryPin && (
          <PinCallout
            title="Delivery PIN (buyer)"
            pin={pins.deliveryPin}
            explainer="Buyer will hand this PIN to the courier at drop-off."
          />
        )}
      </div>
    </section>
  );
}

function InTransitPanel({
  order,
  pins,
}: {
  order: MarketplaceOrder;
  pins: { deliveryPin: string | null; pickupPin: string | null };
}) {
  return (
    <section className="rounded-md border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/40">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-indigo-700 dark:text-indigo-300" />
        <div className="text-sm font-medium text-indigo-800 dark:text-indigo-200">
          Delivery in progress
        </div>
      </div>
      <div className="mt-1 text-xs text-indigo-700 dark:text-indigo-300">
        Courier: <span className="font-mono">{order.courierId?.slice(0, 8)}</span>
      </div>
      <div className="mt-3 space-y-2">
        {pins.deliveryPin && (
          <PinCallout
            title="Delivery PIN (buyer)"
            pin={pins.deliveryPin}
            explainer="Buyer says this PIN to the courier at drop-off. Order flips to Delivered once the courier enters it in-app."
          />
        )}
        {pins.pickupPin && (
          <PinCallout
            title="Pickup PIN (courier)"
            pin={pins.pickupPin}
            explainer="Already used at pickup — shown here for admin reference."
          />
        )}
      </div>
    </section>
  );
}

function DeliveredPanel({ order }: { order: MarketplaceOrder }) {
  const [busy, setBusy] = useState(false);
  const ready = isPayoutReady(order);
  const items = itemsSubtotal(order);
  const feePct = order.platformFeePercent ?? 0;
  const platformFee = Math.round((items * feePct) / 100);
  const sellerAmount = items - platformFee;
  const deliveryFee = order.deliveryFee ?? 0;
  const readyAt = order.deliveredAt
    ? new Date(order.deliveredAt.getTime() + 3 * 24 * 60 * 60 * 1000)
    : null;

  async function run(force = false) {
    if (!force) {
      if (
        !window.confirm(
          `Pay ${order.currency} ${sellerAmount.toLocaleString()} to the seller now?`,
        )
      ) {
        return;
      }
    }
    setBusy(true);
    try {
      const r = await payOutOrderToSeller(order.id, { force });
      toast.success(
        `Paid ${r.currency} ${r.paidToSeller.toLocaleString()} to seller.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payout failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border p-4">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Payout
      </div>
      <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/40">
        <div className="font-medium text-green-800 dark:text-green-200">
          Delivered {fmtDate(order.deliveredAt)}
        </div>
        <div className="mt-1 text-xs text-green-700 dark:text-green-300">
          {ready
            ? "3-day hold complete — you can release the seller's payout now."
            : `3-day hold ends ${readyAt?.toLocaleString() ?? "—"}.`}
        </div>
      </div>
      <div className="mt-3 rounded-md border p-3 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Items subtotal</span>
          <span className="tabular-nums">
            {order.currency} {items.toLocaleString()}
          </span>
        </div>
        <div className="mt-1 flex justify-between text-muted-foreground">
          <span>Platform fee ({feePct}%)</span>
          <span className="tabular-nums">
            − {order.currency} {platformFee.toLocaleString()}
          </span>
        </div>
        <div className="mt-2 flex justify-between font-semibold">
          <span>Seller receives</span>
          <span className="tabular-nums text-primary">
            {order.currency} {sellerAmount.toLocaleString()}
          </span>
        </div>
        <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          Pari keeps {order.currency}{" "}
          {(platformFee + deliveryFee).toLocaleString()} (fee + delivery). No
          scheduler — click below to release.
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => run(false)}
          disabled={busy || !ready}
          size="sm"
        >
          <Undo2 className="mr-1 h-4 w-4 rotate-180" />
          {busy ? "Paying…" : "Pay seller now"}
        </Button>
        {!ready && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Force early payout before the 3-day hold? Audit-logged as forced.",
                )
              ) {
                run(true);
              }
            }}
          >
            Force early payout
          </Button>
        )}
      </div>
    </section>
  );
}

function CancelButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    const reason = window.prompt(
      "Reason for cancellation (optional):",
      "",
    );
    if (reason === null) return;
    setBusy(true);
    try {
      await cancelOrder(orderId, reason);
      toast.success("Order cancelled.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={run}>
      <Ban className="mr-1 h-4 w-4" /> Cancel order
    </Button>
  );
}

function RefundButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    const reason = window.prompt(
      "Reason for refund (shown to the buyer):",
      "",
    );
    if (reason === null) return;
    if (
      !window.confirm(
        "Refund moves the full grand-total from escrow back to the buyer wallet. Continue?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await refundOrder(orderId, reason);
      toast.success("Refund issued.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refund failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={busy}
      onClick={run}
    >
      <Undo2 className="mr-1 h-4 w-4" /> Refund order
    </Button>
  );
}
