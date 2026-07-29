import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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

export type StoreEscalationFlag =
  | "spam_reports"
  | "fraud_suspected"
  | "complaint"
  | "other";

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
  escalationFlag: StoreEscalationFlag | null;
  escalationReason: string | null;
  escalationFlaggedAt: Date | null;
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
    escalationFlag:
      (d.escalationFlag as StoreEscalationFlag | undefined) ?? null,
    escalationReason: (d.escalationReason as string | undefined) ?? null,
    escalationFlaggedAt:
      (d.escalationFlaggedAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

// Live stream of a single store. cb receives null if the doc doesn't exist.
export function subscribeStore(
  storeId: string,
  cb: (store: Store | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(firestore, "stores", storeId),
    (snap) => cb(snap.exists() ? toStore(snap as QueryDocumentSnapshot) : null),
    (err) => onError?.(err),
  );
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

/** Fetches the most recent individual (non-store) marketplace listing
 *  for [uid], or null if they have none. "Individual posting" is the
 *  one item any authenticated user can list without super-admin store
 *  approval — sellerType is anything other than 'store'. */
export async function fetchUserIndividualPosting(
  uid: string,
): Promise<StoreListing | null> {
  const snap = await getDocs(
    query(collection(firestore, "marketplace"), where("sellerId", "==", uid)),
  );
  const items: StoreListing[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    if ((data.sellerType as string | undefined) === "store") continue;
    items.push({
      id: d.id,
      title: (data.title as string | undefined) ?? "",
      price: Number(data.price ?? 0),
      currency: (data.currency as string | undefined) ?? "CFA",
      category: (data.category as string | undefined) ?? "Other",
      status: (data.status as string | undefined) ?? "active",
      imageUrl: (data.imageUrl as string | undefined) ?? null,
      likedByCount: Array.isArray(data.likedBy) ? data.likedBy.length : 0,
      createdAt: (data.createdAt as Timestamp | undefined)?.toDate() ?? null,
    });
  }
  items.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return items[0] ?? null;
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

/// Super-admin action: remove a marketplace listing that violates platform
/// rules. Deletes the doc outright (mobile owner-delete does the same) and
/// records the audit entry with a required reason string. Firestore rules
/// permit isSuperAdmin() on the destructive path so this works regardless
/// of who owns the listing.
export async function removeMarketplaceListing(
  listing: Pick<StoreListing, "id" | "title" | "price" | "currency" | "category" | "status">,
  reason: string,
): Promise<void> {
  await deleteDoc(doc(firestore, "marketplace", listing.id));
  await writeAudit({
    action: "remove_marketplace_listing",
    targetType: "listing",
    targetId: listing.id,
    test: false,
    reason: reason || null,
    before: {
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      category: listing.category,
      status: listing.status,
    },
  });
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

/// Raise an escalation flag on [storeId]. Categorized (spam / fraud /
/// complaint / other) plus a free-form reason for context. Doesn't
/// change store status or restrict listings — pair with suspend/revoke
/// as needed. Passing flag=null clears the escalation.
export async function setStoreEscalation(
  store: Pick<Store, "id" | "ownerId" | "storeName">,
  flag: StoreEscalationFlag | null,
  reason: string = "",
): Promise<void> {
  const ref = doc(firestore, "stores", store.id);
  const before = await getDoc(ref);
  const beforeFlag =
    (before.data()?.escalationFlag as StoreEscalationFlag | undefined) ?? null;
  if (flag === null) {
    await updateDoc(ref, {
      escalationFlag: deleteField(),
      escalationReason: deleteField(),
      escalationFlaggedAt: deleteField(),
    });
  } else {
    await updateDoc(ref, {
      escalationFlag: flag,
      escalationReason: reason || null,
      escalationFlaggedAt: serverTimestamp(),
    });
  }
  await writeAudit({
    action: flag === null ? "clear_store_escalation" : "flag_store_escalation",
    targetType: "store",
    targetId: store.id,
    test: store.ownerId.startsWith("sim_"),
    reason: reason || undefined,
    before: { escalationFlag: beforeFlag },
    after: { escalationFlag: flag },
    metadata: { ownerId: store.ownerId, storeName: store.storeName },
  });
}

/** Super-admin helper — create a store on behalf of [targetUid] and
 *  mark it active straight away (the admin doing the creation is
 *  themselves the approver, so no pending queue trip). Enforces the
 *  same one-store-per-owner rule the panel expects: any existing
 *  store that isn't rejected/revoked blocks a second creation.
 */
export async function createStoreForUser(args: {
  targetUid: string;
  targetName: string;
  storeName: string;
  description: string;
  category: string;
}): Promise<{ storeId: string }> {
  const storeName = args.storeName.trim();
  const category = args.category.trim() || "General";
  if (!storeName) throw new Error("Store name required.");
  if (!args.targetUid) throw new Error("Target user required.");

  const existing = await getDocs(
    query(
      collection(firestore, "stores"),
      where("ownerId", "==", args.targetUid),
      where("status", "in", ["pending", "active", "suspended"]),
      limit(1),
    ),
  );
  if (!existing.empty) {
    throw new Error(
      "This user already has a store. One store per owner.",
    );
  }

  const storeRef = doc(collection(firestore, "stores"));
  await setDoc(storeRef, {
    id: storeRef.id,
    storeName,
    ownerId: args.targetUid,
    ownerName: args.targetName || args.targetUid,
    description: args.description.trim(),
    category,
    status: "active",
    createdAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
  });

  await notify(args.targetUid, {
    type: "store_approved",
    title: "Store created",
    body: `A store "${storeName}" has been created for you. You can now list items as a store vendor.`,
  });

  await writeAudit({
    action: "create_store_for_user",
    targetType: "store",
    targetId: storeRef.id,
    test: args.targetUid.startsWith("sim_"),
    after: {
      ownerId: args.targetUid,
      storeName,
      category,
      status: "active",
    },
  });

  return { storeId: storeRef.id };
}

/** One-shot fetch of every store [uid] owns. Used by the user detail
 *  panel to render the stores list and decide whether the create-store
 *  button should be blocked (one-store-per-owner rule). */
export async function fetchUserStores(uid: string): Promise<Store[]> {
  const snap = await getDocs(
    query(collection(firestore, "stores"), where("ownerId", "==", uid)),
  );
  return snap.docs.map(toStore);
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
