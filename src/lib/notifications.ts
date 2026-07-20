// Notification history + broadcast.
//
// Reads: super admin can query every user's /notifications subcollection at
// once via Firestore's collectionGroup query. Requires a collectionGroup
// rule (added in firestore.rules) plus a Firestore index that Firebase
// prompts for on first call.
//
// Broadcasts: super admin writes one notification into every target user's
// subcollection. Batched in chunks of 400 to stay under Firestore's
// 500-op-per-batch limit. Best-effort per batch; a partial failure surfaces
// as a toast on the caller side.

import {
  addDoc,
  collection,
  collectionGroup,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "./firebase";

export type Notification = {
  id: string;
  userId: string; // uid of the RECIPIENT — parsed from doc path
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: Date | null;
  groupId: string | null;
  listingId: string | null;
};

function toNotification(snap: QueryDocumentSnapshot): Notification {
  const d = snap.data();
  // The path is `users/{uid}/notifications/{notificationId}` — pluck the
  // uid so the panel can show who received it.
  const parts = snap.ref.path.split("/");
  const userId = parts.length >= 2 ? parts[1] : "";
  return {
    id: snap.id,
    userId,
    type: (d.type as string | undefined) ?? "",
    title: (d.title as string | undefined) ?? "",
    body: (d.body as string | undefined) ?? "",
    isRead: Boolean(d.isRead ?? false),
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    groupId: (d.groupId as string | undefined) ?? null,
    listingId: (d.listingId as string | undefined) ?? null,
  };
}

/**
 * Live-updating stream of the most recent notifications across every user's
 * inbox. Uses collectionGroup so all subcollections roll into one query.
 * Bounded by [max] to keep the payload small.
 */
export function subscribeAllNotifications(
  cb: (entries: Notification[]) => void,
  max: number = 200,
  onError?: (e: Error) => void,
) {
  const q = query(
    collectionGroup(firestore, "notifications"),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toNotification)),
    (err) => onError?.(err),
  );
}

export type BroadcastTarget = "all" | "real" | "test";

/**
 * Sends one notification to every target user. Returns the number of
 * successfully delivered writes; a partial batch failure still returns
 * the successful count so callers can surface a mixed result.
 */
export async function sendBroadcast(args: {
  title: string;
  body: string;
  target: BroadcastTarget;
  type?: string;
}): Promise<{ sent: number; totalTargets: number }> {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new Error("Title required.");
  if (!body) throw new Error("Body required.");
  const type = args.type ?? "broadcast";

  // Resolve target uids via one query on /users.
  const usersRef = collection(firestore, "users");
  const usersSnap =
    args.target === "all"
      ? await getDocs(usersRef)
      : args.target === "test"
        ? await getDocs(query(usersRef, where("isTestAccount", "==", true)))
        : await getDocs(query(usersRef, where("isTestAccount", "!=", true)));

  const targetUids = usersSnap.docs.map((d) => d.id);
  const totalTargets = targetUids.length;

  // Firestore batches expect concrete doc refs, but auto-id inbox writes
  // don't have them yet. addDoc in parallel via Promise.all is functionally
  // equivalent for the panel's scale and easier to reason about. Chunked
  // so we don't fire thousands of writes at once.
  const CHUNK = 100;
  let sent = 0;
  for (let i = 0; i < targetUids.length; i += CHUNK) {
    const chunk = targetUids.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (uid) => {
        try {
          await addDoc(collection(firestore, "users", uid, "notifications"), {
            type,
            title,
            body,
            isRead: false,
            createdAt: serverTimestamp(),
          });
          sent += 1;
        } catch {
          // Skip — best-effort per recipient.
        }
      }),
    );
  }

  return { sent, totalTargets };
}

/// Sends a notification to every non-kicked member of a single group.
/// Different rules apply than the platform-wide broadcast (target is
/// scoped to one group's members subcollection) so it lives as its own
/// helper. Returns delivered count; per-recipient errors are swallowed
/// the same way as sendBroadcast so a partial failure still ships what
/// it can.
export async function broadcastToGroupMembers(args: {
  groupId: string;
  title: string;
  body: string;
  type?: string;
}): Promise<{ sent: number; totalTargets: number }> {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new Error("Title required.");
  if (!body) throw new Error("Body required.");
  const type = args.type ?? "group_broadcast";

  const membersSnap = await getDocs(
    collection(firestore, "groups", args.groupId, "members"),
  );
  const targetUids = membersSnap.docs
    .filter((d) => d.data().kicked !== true)
    .map((d) => d.id);
  const totalTargets = targetUids.length;

  const CHUNK = 100;
  let sent = 0;
  for (let i = 0; i < targetUids.length; i += CHUNK) {
    const chunk = targetUids.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (uid) => {
        try {
          await addDoc(collection(firestore, "users", uid, "notifications"), {
            type,
            title,
            body,
            groupId: args.groupId,
            isRead: false,
            createdAt: serverTimestamp(),
          });
          sent += 1;
        } catch {
          /* per-recipient errors swallowed */
        }
      }),
    );
  }
  return { sent, totalTargets };
}
