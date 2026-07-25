import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
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

export type ArchiveTargetType = "user" | "group" | "store";

export type EscalationArchiveEntry = {
  id: string;
  targetType: ArchiveTargetType;
  targetId: string;
  targetName: string;
  targetSecondary: string | null; // email for user, ownerId for store, etc.
  flag: string;
  reason: string | null;
  flaggedAt: Date | null;
  dismissedAt: Date | null;
  dismissedBy: string;
  dismissedByEmail: string;
  dismissNote: string | null;
};

const COL = "escalation_archive";

function toEntry(snap: QueryDocumentSnapshot): EscalationArchiveEntry {
  const d = snap.data();
  return {
    id: snap.id,
    targetType: (d.targetType as ArchiveTargetType | undefined) ?? "user",
    targetId: String(d.targetId ?? ""),
    targetName: String(d.targetName ?? ""),
    targetSecondary: (d.targetSecondary as string | undefined) ?? null,
    flag: String(d.flag ?? "other"),
    reason: (d.reason as string | undefined) ?? null,
    flaggedAt: (d.flaggedAt as Timestamp | undefined)?.toDate() ?? null,
    dismissedAt: (d.dismissedAt as Timestamp | undefined)?.toDate() ?? null,
    dismissedBy: (d.dismissedBy as string | undefined) ?? "",
    dismissedByEmail: (d.dismissedByEmail as string | undefined) ?? "",
    dismissNote: (d.dismissNote as string | undefined) ?? null,
  };
}

async function writeArchive(args: {
  targetType: ArchiveTargetType;
  targetId: string;
  targetName: string;
  targetSecondary?: string | null;
  flag: string;
  reason: string | null;
  flaggedAt: Timestamp | null;
  dismissNote: string;
}): Promise<string> {
  const me = firebaseAuth.currentUser;
  const ref = await addDoc(collection(firestore, COL), {
    targetType: args.targetType,
    targetId: args.targetId,
    targetName: args.targetName,
    targetSecondary: args.targetSecondary ?? null,
    flag: args.flag,
    reason: args.reason,
    flaggedAt: args.flaggedAt,
    dismissedAt: serverTimestamp(),
    dismissedBy: me?.uid ?? "",
    dismissedByEmail: me?.email ?? "",
    dismissNote: args.dismissNote.trim() || null,
  });
  return ref.id;
}

export async function dismissUserEscalationArchive(
  uid: string,
  dismissNote: string = "",
): Promise<void> {
  const ref = doc(firestore, "users", uid);
  const snap = await getDoc(ref);
  const d = snap.data() ?? {};
  const flag = (d.escalationFlag as string | undefined) ?? null;
  if (!flag) return;
  const archiveId = await writeArchive({
    targetType: "user",
    targetId: uid,
    targetName: (d.name as string | undefined) || uid,
    targetSecondary: (d.email as string | undefined) ?? null,
    flag,
    reason: (d.reason as string | undefined) ?? (d.escalationReason as string | undefined) ?? null,
    flaggedAt: (d.escalationFlaggedAt as Timestamp | undefined) ?? null,
    dismissNote,
  });
  await updateDoc(ref, {
    escalationFlag: null,
    escalationReason: null,
    escalationFlaggedAt: null,
  });
  await writeAudit({
    action: "clear_user_escalation",
    targetType: "user",
    targetId: uid,
    test: false,
    reason: dismissNote || null,
    before: { escalationFlag: flag, escalationReason: d.escalationReason ?? null },
    after: { escalationFlag: null, archived: archiveId },
  });
}

export async function dismissGroupEscalationArchive(
  groupId: string,
  dismissNote: string = "",
): Promise<void> {
  const ref = doc(firestore, "groups", groupId);
  const snap = await getDoc(ref);
  const d = snap.data() ?? {};
  const flag = (d.adminEscalationFlag as string | undefined) ?? null;
  if (!flag) return;
  const archiveId = await writeArchive({
    targetType: "group",
    targetId: groupId,
    targetName: (d.name as string | undefined) || groupId,
    targetSecondary: null,
    flag,
    reason: (d.adminEscalationReason as string | undefined) ?? null,
    flaggedAt: (d.adminEscalationFlaggedAt as Timestamp | undefined) ?? null,
    dismissNote,
  });
  await updateDoc(ref, {
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });
  await writeAudit({
    action: "dismiss_escalation",
    targetType: "group",
    targetId: groupId,
    test: (d.moneyProvider as string | undefined) === "mock",
    reason: dismissNote || null,
    before: { adminEscalationFlag: flag },
    after: { adminEscalationFlag: null, archived: archiveId },
  });
}

export async function dismissStoreEscalationArchive(
  storeId: string,
  dismissNote: string = "",
): Promise<void> {
  const ref = doc(firestore, "stores", storeId);
  const snap = await getDoc(ref);
  const d = snap.data() ?? {};
  const flag = (d.escalationFlag as string | undefined) ?? null;
  if (!flag) return;
  const archiveId = await writeArchive({
    targetType: "store",
    targetId: storeId,
    targetName: (d.storeName as string | undefined) || storeId,
    targetSecondary: (d.ownerName as string | undefined) ?? (d.ownerId as string | undefined) ?? null,
    flag,
    reason: (d.escalationReason as string | undefined) ?? null,
    flaggedAt: (d.escalationFlaggedAt as Timestamp | undefined) ?? null,
    dismissNote,
  });
  await updateDoc(ref, {
    escalationFlag: deleteField(),
    escalationReason: deleteField(),
    escalationFlaggedAt: deleteField(),
  });
  await writeAudit({
    action: "clear_store_escalation",
    targetType: "store",
    targetId: storeId,
    test: String(d.ownerId ?? "").startsWith("sim_"),
    reason: dismissNote || null,
    before: { escalationFlag: flag },
    after: { escalationFlag: null, archived: archiveId },
  });
}

export function subscribeArchiveForTarget(
  targetType: ArchiveTargetType,
  targetId: string,
  cb: (entries: EscalationArchiveEntry[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, COL),
    where("targetType", "==", targetType),
    where("targetId", "==", targetId),
    orderBy("dismissedAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toEntry)),
    (err) => onError?.(err),
  );
}

export function subscribeAllArchive(
  cb: (entries: EscalationArchiveEntry[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, COL),
    orderBy("dismissedAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toEntry)),
    (err) => onError?.(err),
  );
}
