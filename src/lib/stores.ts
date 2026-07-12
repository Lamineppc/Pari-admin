import {
  addDoc,
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";
import { writeAudit } from "./audit";

// Mirrors lib/models/store_model.dart on mobile.
// `suspended` is a reversible pause — myActiveStore() on mobile returns
// null for anything != 'active', so a suspended store can't post new
// store-vendor listings without any client-side change.
export type StoreStatus =
  | "pending"
  | "active"
  | "suspended"
  | "rejected"
  | "revoked";

export type Store = {
  id: string;
  storeName: string;
  ownerId: string;
  ownerName: string;
  description: string;
  category: string;
  status: StoreStatus;
  rejectionReason: string | null;
  createdAt: Date | null;
  approvedAt: Date | null;
};

export type StoreListing = {
  id: string;
  title: string;
  price: number;
  currency: string;
  category: string;
  status: string;
  imageUrl: string | null;
  likedByCount: number;
  createdAt: Date | null;
};

export type StoreMetrics = {
  totalListings: number;
  activeListings: number;
  soldListings: number;
  totalLikes: number;
};

function toStore(snap: QueryDocumentSnapshot): Store {
  const d = snap.data();
  return {
    id: snap.id,
    storeName: (d.storeName as string | undefined) ?? "",
    ownerId: (d.ownerId as string | undefined) ?? "",
    ownerName: (d.ownerName as string | undefined) ?? "",
    description: (d.description as string | undefined) ?? "",
    category: (d.category as string | undefined) ?? "General",
    status: (d.status as StoreStatus | undefined) ?? "pending",
    rejectionReason: (d.rejectionReason as string | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    approvedAt: (d.approvedAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

// Live stream of every store application, newest first.
export function subscribeStores(cb: (stores: Store[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(firestore, "stores"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toStore)),
    (err) => onError?.(err),
  );
}

async function notify(ownerId: string, payload: { type: string; title: string; body: string }) {
  if (firebaseAuth.currentUser?.uid === ownerId) return;
  try {
    await addDoc(collection(firestore, "users", ownerId, "notifications"), {
      ...payload,
      isRead: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // best-effort
  }
}

export async function approveStore(store: Pick<Store, "id" | "ownerId" | "storeName">) {
  await updateDoc(doc(firestore, "stores", store.id), {
    status: "active",
    rejectionReason: deleteField(),
    approvedAt: serverTimestamp(),
  });
  await notify(store.ownerId, {
    type: "store_approved",
    title: "Store approved",
    body: `Your store "${store.storeName}" has been approved. You can now list items as a store vendor.`,
  });
  await writeAudit({
    action: "approve_store",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    after: { status: "active" },
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}

export async function suspendStore(
  store: Pick<Store, "id" | "ownerId" | "storeName">,
  reason: string,
) {
  await updateDoc(doc(firestore, "stores", store.id), {
    status: "suspended",
    ...(reason ? { rejectionReason: reason } : {}),
  });
  await notify(store.ownerId, {
    type: "store_suspended",
    title: "Store temporarily paused",
    body: reason
      ? `Your store "${store.storeName}" has been paused: ${reason}`
      : `Your store "${store.storeName}" has been paused. Please contact support.`,
  });
  await writeAudit({
    action: "suspend_store",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    after: { status: "suspended", rejectionReason: reason || null },
    reason: reason || null,
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}

export async function reinstateStore(
  store: Pick<Store, "id" | "ownerId" | "storeName">,
) {
  await updateDoc(doc(firestore, "stores", store.id), {
    status: "active",
    rejectionReason: deleteField(),
  });
  await notify(store.ownerId, {
    type: "store_reinstated",
    title: "Store reinstated",
    body: `Your store "${store.storeName}" access has been restored. You can list items again.`,
  });
  await writeAudit({
    action: "reinstate_store",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    after: { status: "active" },
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}

/** Live stream of every marketplace listing published under this store's
 *  owner. The panel filters on sellerType==='store' to exclude the
 *  owner's one personal listing (if they have one). */
export function subscribeStoreListings(
  ownerId: string,
  cb: (items: StoreListing[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "marketplace"),
    where("sellerId", "==", ownerId),
    where("sellerType", "==", "store"),
    orderBy("createdAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) =>
      cb(
        s.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            title: (d.title as string | undefined) ?? "",
            price: Number(d.price ?? 0),
            currency: (d.currency as string | undefined) ?? "CFA",
            category: (d.category as string | undefined) ?? "Other",
            status: (d.status as string | undefined) ?? "active",
            imageUrl: (d.imageUrl as string | undefined) ?? null,
            likedByCount: Array.isArray(d.likedBy) ? d.likedBy.length : 0,
            createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
          };
        }),
      ),
    (err) => onError?.(err),
  );
}

export function computeMetrics(items: StoreListing[]): StoreMetrics {
  let active = 0;
  let sold = 0;
  let likes = 0;
  for (const it of items) {
    if (it.status === "active") active++;
    if (it.status === "sold") sold++;
    likes += it.likedByCount;
  }
  return {
    totalListings: items.length,
    activeListings: active,
    soldListings: sold,
    totalLikes: likes,
  };
}

export async function rejectStore(
  store: Pick<Store, "id" | "ownerId" | "storeName">,
  reason: string,
) {
  await updateDoc(doc(firestore, "stores", store.id), {
    status: "rejected",
    ...(reason ? { rejectionReason: reason } : {}),
  });
  await notify(store.ownerId, {
    type: "store_rejected",
    title: "Store application declined",
    body: reason
      ? `Your application for "${store.storeName}" was not approved: ${reason}`
      : `Your application for "${store.storeName}" was not approved.`,
  });
  await writeAudit({
    action: "reject_store",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    after: { status: "rejected", rejectionReason: reason || null },
    reason: reason || null,
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}

export async function revokeStore(
  store: Pick<Store, "id" | "ownerId" | "storeName">,
  reason: string,
) {
  await updateDoc(doc(firestore, "stores", store.id), {
    status: "revoked",
    ...(reason ? { rejectionReason: reason } : {}),
  });
  await notify(store.ownerId, {
    type: "store_revoked",
    title: "Store access revoked",
    body: reason
      ? `Your store "${store.storeName}" access has been revoked: ${reason}`
      : `Your store "${store.storeName}" access has been revoked.`,
  });
  await writeAudit({
    action: "revoke_store",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    after: { status: "revoked", rejectionReason: reason || null },
    reason: reason || null,
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}
