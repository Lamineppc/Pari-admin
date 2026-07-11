// Kick + refund audit — every kicked member across every group in one
// place. Read-only view; corrections must be done through the group's
// normal admin flow so the ledger stays consistent.
//
// Backed by a collectionGroup('members') query filtered on kicked==true.
// Firestore may prompt on first read to create an index (kicked ASC,
// kickedAt DESC).

import {
  collectionGroup,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "./firebase";

export type KickRecord = {
  id: string; // memberId (uid)
  groupId: string; // parsed from doc path
  userId: string;
  userName: string;
  role: string;
  position: number | null;
  kickedAt: Date | null;
  refundAmount: number;
  kickReason: string | null;
};

function toKick(snap: QueryDocumentSnapshot): KickRecord {
  const d = snap.data();
  // path: `groups/{groupId}/members/{memberId}`
  const parts = snap.ref.path.split("/");
  const groupId = parts.length >= 2 ? parts[1] : "";
  return {
    id: snap.id,
    groupId,
    userId: (d.userId as string | undefined) ?? snap.id,
    userName: (d.name as string | undefined) ?? "",
    role: (d.role as string | undefined) ?? "member",
    position: (d.position as number | undefined) ?? null,
    kickedAt: (d.kickedAt as Timestamp | undefined)?.toDate() ?? null,
    refundAmount: Number(d.refundAmount ?? 0),
    kickReason: (d.kickReason as string | undefined) ?? null,
  };
}

/**
 * Live-updating stream of every kicked member across all groups, newest
 * first. Bounded by [max] to keep payload small; a dedicated "load more"
 * path can be added if the platform ever needs it.
 */
export function subscribeKicks(
  cb: (kicks: KickRecord[]) => void,
  max: number = 300,
  onError?: (e: Error) => void,
) {
  const q = query(
    collectionGroup(firestore, "members"),
    where("kicked", "==", true),
    orderBy("kickedAt", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toKick)),
    (err) => onError?.(err),
  );
}
