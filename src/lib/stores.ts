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
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

// Mirrors lib/models/store_model.dart on mobile.
export type StoreStatus = "pending" | "active" | "rejected" | "revoked";

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
  });
  await notify(store.ownerId, {
    type: "store_approved",
    title: "Store approved",
    body: `Your store "${store.storeName}" has been approved. You can now list items as a store vendor.`,
  });
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
}
