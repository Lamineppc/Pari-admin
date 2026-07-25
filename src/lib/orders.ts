import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
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
  courierId: string | null;
  pin: string | null;
  createdAt: Date | null;
  quotedAt: Date | null;
  paidAt: Date | null;
  inTransitAt: Date | null;
  deliveredAt: Date | null;
  paidOutAt: Date | null;
  cancelledAt: Date | null;
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
    courierId: (d.courierId as string | undefined) ?? null,
    pin: (d.pin as string | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    quotedAt: (d.quotedAt as Timestamp | undefined)?.toDate() ?? null,
    paidAt: (d.paidAt as Timestamp | undefined)?.toDate() ?? null,
    inTransitAt: (d.inTransitAt as Timestamp | undefined)?.toDate() ?? null,
    deliveredAt: (d.deliveredAt as Timestamp | undefined)?.toDate() ?? null,
    paidOutAt: (d.paidOutAt as Timestamp | undefined)?.toDate() ?? null,
    cancelledAt: (d.cancelledAt as Timestamp | undefined)?.toDate() ?? null,
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
) {
  const q = query(
    collection(firestore, "orders"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toOrder)),
    (err) => onError?.(err),
  );
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

/// Generate a 6-digit numeric PIN, assign the courier, flip status to
/// in_transit, and notify the buyer with the PIN. The buyer hands the
/// PIN to the courier on arrival; the courier enters it in the app to
/// mark delivered (Phase E enforces this via the courier-side rule).
export async function assignCourierAndIssuePin(
  orderId: string,
  courierId: string,
): Promise<{ pin: string }> {
  if (!courierId.trim()) throw new Error("Pick a courier first.");
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  await updateDoc(doc(firestore, "orders", orderId), {
    courierId,
    pin,
    status: "in_transit",
    inTransitAt: serverTimestamp(),
  });
  await writeAudit({
    action: "assign_courier_and_issue_pin",
    targetType: "order",
    targetId: orderId,
    test: false,
    after: { courierId, pin: "***" }, // don't leak PIN into audit
  });
  const orderSnap = await getDoc(doc(firestore, "orders", orderId));
  const buyerId = String(orderSnap.data()?.buyerId ?? "");
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
  return { pin };
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
  const buyerWalletRef = doc(firestore, "mockWallets", `user_${buyerId}`);
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
