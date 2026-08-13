import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";
import { writeAudit } from "./audit";

/// Mirrors the mobile MarketplaceOrder model exactly.
export type OrderStatus =
  | "awaiting_quote"
  | "quoted"
  | "paid"
  | "awaiting_pickup"
  | "in_transit"
  | "delivered"
  | "paid_out"
  | "cancelled"
  | "refunded";

export type OrderLine = {
  listingId: string;
  title: string;
  price: number;
  quantity: number;
  sellerId: string;
  sellerName: string;
  imageUrl: string | null;
};

export type DeliveryDestination = {
  description: string;
  phone: string;
  lat: number | null;
  lng: number | null;
};

export type MarketplaceOrder = {
  id: string;
  buyerId: string;
  buyerName: string;
  sellerId: string;
  lines: OrderLine[];
  currency: string;
  destination: DeliveryDestination;
  status: OrderStatus;
  deliveryFee: number | null;
  platformFeePercent: number | null;
  paymentMethod: "cash" | "mobile_money" | null;
  courierId: string | null;
  createdAt: Date | null;
  awaitingPickupAt: Date | null;
  quotedAt: Date | null;
  paidAt: Date | null;
  inTransitAt: Date | null;
  deliveredAt: Date | null;
  paidOutAt: Date | null;
  cancelledAt: Date | null;
  cashCollectedAt: Date | null;
};

function toOrder(snap: QueryDocumentSnapshot): MarketplaceOrder {
  const d = snap.data();
  return {
    id: snap.id,
    buyerId: String(d.buyerId ?? ""),
    buyerName: String(d.buyerName ?? ""),
    sellerId: String(d.sellerId ?? ""),
    lines: ((d.lines as Array<Record<string, unknown>>) ?? []).map((l) => ({
      listingId: String(l.listingId ?? ""),
      title: String(l.title ?? ""),
      price: Number(l.price ?? 0),
      quantity: Number(l.quantity ?? 1),
      sellerId: String(l.sellerId ?? ""),
      sellerName: String(l.sellerName ?? ""),
      imageUrl: (l.imageUrl as string | undefined) ?? null,
    })),
    currency: String(d.currency ?? "CFA"),
    destination: {
      description: String(
        (d.destination as Record<string, unknown> | undefined)?.description ??
          "",
      ),
      phone: String(
        (d.destination as Record<string, unknown> | undefined)?.phone ?? "",
      ),
      lat:
        ((d.destination as Record<string, unknown> | undefined)?.lat as
          | number
          | undefined) ?? null,
      lng:
        ((d.destination as Record<string, unknown> | undefined)?.lng as
          | number
          | undefined) ?? null,
    },
    status: (d.status as OrderStatus | undefined) ?? "awaiting_quote",
    deliveryFee: (d.deliveryFee as number | undefined) ?? null,
    platformFeePercent: (d.platformFeePercent as number | undefined) ?? null,
    paymentMethod:
      (d.paymentMethod as "cash" | "mobile_money" | undefined) ?? null,
    courierId: (d.courierId as string | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    awaitingPickupAt:
      (d.awaitingPickupAt as Timestamp | undefined)?.toDate() ?? null,
    quotedAt: (d.quotedAt as Timestamp | undefined)?.toDate() ?? null,
    paidAt: (d.paidAt as Timestamp | undefined)?.toDate() ?? null,
    inTransitAt: (d.inTransitAt as Timestamp | undefined)?.toDate() ?? null,
    deliveredAt: (d.deliveredAt as Timestamp | undefined)?.toDate() ?? null,
    paidOutAt: (d.paidOutAt as Timestamp | undefined)?.toDate() ?? null,
    cancelledAt: (d.cancelledAt as Timestamp | undefined)?.toDate() ?? null,
    cashCollectedAt:
      (d.cashCollectedAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

export function itemsSubtotal(o: Pick<MarketplaceOrder, "lines">): number {
  return o.lines.reduce((total, l) => total + l.price * l.quantity, 0);
}

export function grandTotal(o: MarketplaceOrder): number | null {
  if (o.deliveryFee == null) return null;
  return itemsSubtotal(o) + o.deliveryFee;
}

export function subscribeOrders(
  cb: (orders: MarketplaceOrder[]) => void,
  onError?: (e: Error) => void,
  max: number = 200,
) {
  const q = query(
    collection(firestore, "orders"),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toOrder)),
    (err) => onError?.(err),
  );
}

export function subscribeOrderPins(
  orderId: string,
  cb: (pins: { deliveryPin: string | null; pickupPin: string | null }) => void,
): () => void {
  let deliveryPin: string | null = null;
  let pickupPin: string | null = null;
  const unsub1 = onSnapshot(
    doc(firestore, "orders", orderId, "secure", "delivery"),
    (snap) => {
      deliveryPin = (snap.data()?.pin as string | undefined) ?? null;
      cb({ deliveryPin, pickupPin });
    },
    (err) => console.error("[subscribeOrderPins] delivery", err),
  );
  const unsub2 = onSnapshot(
    doc(firestore, "orders", orderId, "secure", "pickup"),
    (snap) => {
      pickupPin = (snap.data()?.pin as string | undefined) ?? null;
      cb({ deliveryPin, pickupPin });
    },
    (err) => console.error("[subscribeOrderPins] pickup", err),
  );
  // Fallback for legacy orders whose PINs still live on the main order doc.
  const unsub3 = onSnapshot(
    doc(firestore, "orders", orderId),
    (snap) => {
      const d = snap.data() ?? {};
      if (!deliveryPin && typeof d.pin === "string") {
        deliveryPin = d.pin;
        cb({ deliveryPin, pickupPin });
      }
      if (!pickupPin && typeof d.pickupPin === "string") {
        pickupPin = d.pickupPin;
        cb({ deliveryPin, pickupPin });
      }
    },
    (err) => console.error("[subscribeOrderPins] order", err),
  );
  return () => {
    unsub1();
    unsub2();
    unsub3();
  };
}

export function subscribeOrder(
  orderId: string,
  cb: (order: MarketplaceOrder | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(firestore, "orders", orderId),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      cb(toOrder(snap as QueryDocumentSnapshot));
    },
    (err) => onError?.(err),
  );
}

/// Super-admin quotes the delivery fee. Flips status awaiting_quote →
/// quoted so the buyer can accept + pay.
export async function quoteOrder(
  orderId: string,
  deliveryFee: number,
): Promise<void> {
  if (!Number.isFinite(deliveryFee) || deliveryFee < 0) {
    throw new Error("Delivery fee must be a non-negative number.");
  }
  await updateDoc(doc(firestore, "orders", orderId), {
    deliveryFee,
    status: "quoted",
    quotedAt: serverTimestamp(),
  });
  await writeAudit({
    action: "quote_order",
    targetType: "order",
    targetId: orderId,
    test: false,
    after: { deliveryFee },
  });
  // Notify buyer that the quote is ready.
  const orderSnap = await getDoc(doc(firestore, "orders", orderId));
  const buyerId = String(orderSnap.data()?.buyerId ?? "");
  const currency = String(orderSnap.data()?.currency ?? "CFA");
  if (buyerId) {
    await addDoc(collection(firestore, "users", buyerId, "notifications"), {
      type: "order_quote_ready",
      title: "Delivery quote ready",
      body: `Pari has set your delivery fee at ${currency} ${deliveryFee.toLocaleString()}. Open the order to accept and pay.`,
      isRead: false,
      createdAt: serverTimestamp(),
      metadata: { orderId },
    });
  }
}

/// Assign a courier + issue BOTH pins for the two-checkpoint delivery
/// flow.
///
/// * pickupPin — courier tells this to the seller at the pickup point.
///   Seller types it into the app to release the item (advances
///   awaiting_pickup → in_transit).
/// * deliveryPin (stored as `pin`) — buyer tells this to the courier
///   at drop-off. Courier types it into the app to close the delivery
///   (advances in_transit → delivered).
///
/// Notifies all three parties. Order goes to `awaiting_pickup` (not
/// straight to `in_transit`) so the pickup checkpoint is a real gate.
export async function assignCourierAndIssuePin(
  orderId: string,
  courierId: string,
  opts: { skipPickupCheckpoint?: boolean } = {},
): Promise<{ pin: string; pickupPin: string | null }> {
  if (!courierId.trim()) throw new Error("Pick a courier first.");
  const orderRef = doc(firestore, "orders", orderId);
  const currentSnap = await getDoc(orderRef);
  const currentStatus = String(currentSnap.data()?.status ?? "");
  // Admin override: when the pickup already physically happened but a
  // prior reassign rewound status, treat this as an in_transit reissue.
  const treatAsInTransit =
    currentStatus === "in_transit" ||
    ((currentStatus === "awaiting_pickup" || currentStatus === "paid") &&
      opts.skipPickupCheckpoint === true);
  // Reissue policy: only regenerate PINs for stages that haven't
  // been validated yet, so a mid-flight courier swap doesn't invalidate
  // a checkpoint the previous courier already completed.
  const reissuePickup = !treatAsInTransit;
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const pickupPin = reissuePickup
    ? String(Math.floor(100000 + Math.random() * 900000))
    : null;
  const writes: Promise<unknown>[] = [
    setDoc(doc(orderRef, "secure", "delivery"), {
      pin,
      updatedAt: serverTimestamp(),
    }),
  ];
  if (reissuePickup && pickupPin) {
    writes.push(
      setDoc(doc(orderRef, "secure", "pickup"), {
        pin: pickupPin,
        updatedAt: serverTimestamp(),
      }),
    );
  }
  await Promise.all(writes);
  const orderUpdate: Record<string, unknown> = { courierId };
  if (
    (currentStatus === "paid" || currentStatus === "awaiting_pickup") &&
    opts.skipPickupCheckpoint === true
  ) {
    orderUpdate.status = "in_transit";
    orderUpdate.inTransitAt = serverTimestamp();
    if (currentStatus === "paid") {
      orderUpdate.awaitingPickupAt = serverTimestamp();
    }
  } else if (currentStatus === "paid") {
    orderUpdate.status = "awaiting_pickup";
    orderUpdate.awaitingPickupAt = serverTimestamp();
  }
  await updateDoc(orderRef, orderUpdate);
  await writeAudit({
    action: "assign_courier_and_issue_pin",
    targetType: "order",
    targetId: orderId,
    test: false,
    after: {
      courierId,
      pin: "***",
      pickupPin: reissuePickup ? "***" : "unchanged",
      priorStatus: currentStatus,
    },
  });
  const buyerId = String(currentSnap.data()?.buyerId ?? "");
  const sellerId = String(currentSnap.data()?.sellerId ?? "");
  if (buyerId) {
    await addDoc(collection(firestore, "users", buyerId, "notifications"), {
      type: "order_delivery_pin",
      title: "Your delivery is on the way",
      body: `Give this PIN to the courier when they arrive: ${pin}. Do not share it before then.`,
      isRead: false,
      createdAt: serverTimestamp(),
      metadata: { orderId, pin },
    });
  }
  if (courierId && reissuePickup && pickupPin) {
    await addDoc(
      collection(firestore, "users", courierId, "notifications"),
      {
        type: "delivery_pickup_pin",
        title: "New pickup assigned",
        body: `Say this PIN to the seller so they can release the item: ${pickupPin}. Do not share it with anyone else.`,
        isRead: false,
        createdAt: serverTimestamp(),
        metadata: { orderId, pickupPin },
      },
    );
  } else if (courierId && !reissuePickup) {
    await addDoc(
      collection(firestore, "users", courierId, "notifications"),
      {
        type: "delivery_takeover",
        title: "Delivery reassigned to you",
        body: "You're now the courier for an in-transit order. Ask the buyer for the delivery PIN at drop-off.",
        isRead: false,
        createdAt: serverTimestamp(),
        metadata: { orderId },
      },
    );
  }
  if (sellerId && reissuePickup) {
    await addDoc(
      collection(firestore, "users", sellerId, "notifications"),
      {
        type: "order_awaiting_pickup",
        title: "Courier on the way to collect",
        body: "A courier is on the way to pick up the item. They'll give you a PIN — enter it in the app to hand it over.",
        isRead: false,
        createdAt: serverTimestamp(),
        metadata: { orderId },
      },
    );
  }
  return { pin, pickupPin };
}

/// Record that cash was collected (for a cash-on-delivery order).
/// Admin-side counterpart to the courier button — useful if the
/// courier forgot to record it in the app.
export async function recordCashCollected(orderId: string): Promise<void> {
  const orderRef = doc(firestore, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error("Order not found.");
  const data = orderSnap.data();
  if (data.paymentMethod !== "cash") {
    throw new Error("This order is not a cash order.");
  }
  if (data.status !== "delivered") {
    throw new Error("Cash can only be recorded after delivery.");
  }
  if (data.cashCollectedAt) {
    throw new Error("Cash has already been recorded.");
  }
  await updateDoc(orderRef, {
    cashCollectedAt: serverTimestamp(),
  });
  await writeAudit({
    action: "record_cash_collected",
    targetType: "order",
    targetId: orderId,
    test: false,
  });
}

/// Super-admin cancel — allowed at any pre-delivered state. Refunds
/// happen via [refundOrder] separately when funds are already in
/// escrow.
export async function cancelOrder(orderId: string, reason?: string): Promise<void> {
  await updateDoc(doc(firestore, "orders", orderId), {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelReason: reason ?? null,
  });
  await writeAudit({
    action: "cancel_order",
    targetType: "order",
    targetId: orderId,
    test: false,
    reason,
    after: { status: "cancelled" },
  });
}

/// Manual T+3d payout. Admin fires this once the 3-day hold has
/// elapsed after delivery. Moves (itemsSubtotal - platformFee) from
/// the marketplace escrow wallet to the seller's mock wallet. The
/// platform fee + delivery fee stay in escrow as Pari revenue and
/// can be swept out later by a super admin action.
///
/// Guardrail: refuses to run before deliveredAt + 3 days. Admin can
/// override via `force: true` (audit-logged as such).
export type PayoutResult = {
  paidToSeller: number;
  platformFeeCollected: number;
  deliveryFeeCollected: number;
  currency: string;
};

export async function payOutOrderToSeller(
  orderId: string,
  options: { force?: boolean } = {},
): Promise<PayoutResult> {
  const orderRef = doc(firestore, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error("Order not found.");
  const d = orderSnap.data();
  const status = d.status as OrderStatus | undefined;
  if (status !== "delivered") {
    throw new Error("Payout only applies to delivered orders.");
  }
  const deliveredAtTs = d.deliveredAt as Timestamp | undefined;
  const deliveredAt = deliveredAtTs?.toDate();
  if (!deliveredAt) throw new Error("Delivered timestamp missing.");
  const holdMs = 3 * 24 * 60 * 60 * 1000;
  const readyAt = deliveredAt.getTime() + holdMs;
  if (!options.force && Date.now() < readyAt) {
    const days = Math.ceil((readyAt - Date.now()) / (24 * 60 * 60 * 1000));
    throw new Error(
      `3-day hold not up yet — ${days} day(s) remaining. Use force to override.`,
    );
  }

  const currency = String(d.currency ?? "CFA").toLowerCase();
  const sellerId = String(d.sellerId ?? "");
  const items = ((d.lines as Array<Record<string, unknown>>) ?? []).reduce(
    (t, l) => t + Number(l.price ?? 0) * Number(l.quantity ?? 1),
    0,
  );
  const deliveryFee = Number(d.deliveryFee ?? 0);
  const feePct = Number(d.platformFeePercent ?? 0);
  const platformFee = Math.round((items * feePct) / 100);
  const sellerAmount = items - platformFee;
  if (sellerAmount <= 0) {
    throw new Error("Seller amount computes to zero or negative — refusing.");
  }

  const escrowRef = doc(firestore, "mockWallets", `mkt_escrow_${currency}`);
  const sellerWalletRef = doc(firestore, "mockWallets", `user:${sellerId}`);
  await runTransaction(firestore, async (tx) => {
    const eSnap = await tx.get(escrowRef);
    const sSnap = await tx.get(sellerWalletRef);
    const eBal = Number(eSnap.data()?.balance ?? 0);
    const sBal = Number(sSnap.data()?.balance ?? 0);
    if (eBal < sellerAmount) {
      throw new Error(
        `Escrow balance too low for payout (has ${eBal}, needs ${sellerAmount}).`,
      );
    }
    tx.set(escrowRef, {
      balance: eBal - sellerAmount,
      currency: currency.toUpperCase(),
      updatedAt: serverTimestamp(),
    });
    tx.set(sellerWalletRef, {
      balance: sBal + sellerAmount,
      currency: currency.toUpperCase(),
      updatedAt: serverTimestamp(),
    });
    tx.update(orderRef, {
      status: "paid_out",
      paidOutAt: serverTimestamp(),
      sellerPayoutAmount: sellerAmount,
      platformFeeCollected: platformFee,
      deliveryFeeCollected: deliveryFee,
    });
  });

  await writeAudit({
    action: "pay_out_order",
    targetType: "order",
    targetId: orderId,
    test: false,
    reason: options.force ? "forced_before_3d_hold" : null,
    after: { sellerAmount, platformFee, deliveryFee, forced: !!options.force },
  });
  if (sellerId) {
    await addDoc(collection(firestore, "users", sellerId, "notifications"), {
      type: "order_paid_out",
      title: "You've been paid",
      body: `Pari released ${currency.toUpperCase()} ${sellerAmount.toLocaleString()} to your wallet for a completed marketplace order.`,
      isRead: false,
      createdAt: serverTimestamp(),
      metadata: { orderId, amount: sellerAmount },
    });
  }
  return {
    paidToSeller: sellerAmount,
    platformFeeCollected: platformFee,
    deliveryFeeCollected: deliveryFee,
    currency: currency.toUpperCase(),
  };
}

/// Utility: is [order] ready for payout right now? Used by the
/// dashboard/filter to surface "payout due" without a scheduler.
export function isPayoutReady(o: MarketplaceOrder): boolean {
  if (o.status !== "delivered") return false;
  if (!o.deliveredAt) return false;
  return Date.now() >= o.deliveredAt.getTime() + 3 * 24 * 60 * 60 * 1000;
}

/// Refund a paid order — moves the full grand-total back from the
/// marketplace escrow wallet to the buyer's wallet and marks the
/// order refunded. Uses the same mock-money layer as checkout while
/// Orange Money is missing.
export async function refundOrder(orderId: string, reason?: string): Promise<void> {
  const orderRef = doc(firestore, "orders", orderId);
  const orderSnap = await getDoc(orderRef);
  if (!orderSnap.exists()) throw new Error("Order not found.");
  const d = orderSnap.data();
  const status = d.status as OrderStatus | undefined;
  if (status !== "paid" && status !== "in_transit") {
    throw new Error("Refund only applies to paid or in-transit orders.");
  }
  const currency = String(d.currency ?? "CFA").toLowerCase();
  const buyerId = String(d.buyerId ?? "");
  const items = ((d.lines as Array<Record<string, unknown>>) ?? []).reduce(
    (t, l) => t + Number(l.price ?? 0) * Number(l.quantity ?? 1),
    0,
  );
  const deliveryFee = Number(d.deliveryFee ?? 0);
  const total = items + deliveryFee;

  const escrowRef = doc(firestore, "mockWallets", `mkt_escrow_${currency}`);
  const buyerWalletRef = doc(firestore, "mockWallets", `user:${buyerId}`);
  await runTransaction(firestore, async (tx) => {
    const eSnap = await tx.get(escrowRef);
    const bSnap = await tx.get(buyerWalletRef);
    const eBal = Number(eSnap.data()?.balance ?? 0);
    const bBal = Number(bSnap.data()?.balance ?? 0);
    if (eBal < total) {
      throw new Error(
        `Escrow balance too low for refund (has ${eBal}, needs ${total}).`,
      );
    }
    tx.set(escrowRef, {
      balance: eBal - total,
      currency: currency.toUpperCase(),
      updatedAt: serverTimestamp(),
    });
    tx.set(buyerWalletRef, {
      balance: bBal + total,
      currency: currency.toUpperCase(),
      updatedAt: serverTimestamp(),
    });
    tx.update(orderRef, {
      status: "refunded",
      cancelledAt: serverTimestamp(),
      refundReason: reason ?? null,
    });
  });
  await writeAudit({
    action: "refund_order",
    targetType: "order",
    targetId: orderId,
    test: false,
    reason,
    after: { refunded: total },
  });
  if (buyerId) {
    await addDoc(collection(firestore, "users", buyerId, "notifications"), {
      type: "order_refunded",
      title: "Order refunded",
      body: reason
        ? `Your order was refunded: ${reason}. The funds are back in your wallet.`
        : "Your order was refunded. The funds are back in your wallet.",
      isRead: false,
      createdAt: serverTimestamp(),
      metadata: { orderId },
    });
  }
}

/// List courier candidates — users whose `roles` array contains
/// 'courier'. Fetched once on demand, not streamed, since the
/// courier roster changes rarely.
export type CourierCandidate = {
  uid: string;
  name: string;
  email: string;
};

export async function listCouriers(): Promise<CourierCandidate[]> {
  // Firestore rules already read users; require array-contains.
  const { getDocs, query: q2, collection: col, where: w } = await import(
    "firebase/firestore"
  );
  const snap = await getDocs(
    q2(col(firestore, "users"), w("roles", "array-contains", "courier")),
  );
  return snap.docs.map((d) => ({
    uid: d.id,
    name: String(d.data().name ?? ""),
    email: String(d.data().email ?? ""),
  }));
}

/// Toggle courier role on a target user. Rule now excludes `roles`
/// from user-side updates so this only fires from a super-admin
/// session.
export async function setUserCourierRole(
  uid: string,
  isCourier: boolean,
): Promise<void> {
  const ref = doc(firestore, "users", uid);
  const snap = await getDoc(ref);
  const roles = ((snap.data()?.roles as string[] | undefined) ?? []).filter(
    (r) => r !== "courier",
  );
  if (isCourier) roles.push("courier");
  await updateDoc(ref, { roles });
  await writeAudit({
    action: isCourier ? "grant_courier_role" : "revoke_courier_role",
    targetType: "user",
    targetId: uid,
    test: false,
    after: { roles },
  });
}

// Minimal helper: current super-admin uid for audit inference.
export function currentAdminUid(): string | null {
  return firebaseAuth.currentUser?.uid ?? null;
}
