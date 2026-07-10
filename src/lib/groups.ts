import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

// Mirrors the subset of lib/models/group_model.dart used by the admin panel.
// Adminescalation* fields match PR 5b in the mobile repo.
export type GroupType = "traditional" | "secured";
export type GroupStatus = "active" | "inactive";
export type SecuredPhase = "notStarted" | "collateral" | "distribution" | "closed";
export type AdminEscalationFlag = "admin_default" | "manager_default" | "both_default";

export type Group = {
  id: string;
  type: GroupType;
  name: string;
  description: string;
  amount: number;
  currency: string;
  frequency: string;
  createdBy: string;
  status: GroupStatus;
  memberCount: number;
  currentCycle: number | null;
  positionsLocked: boolean;
  adminEscalationFlag: AdminEscalationFlag | null;
  adminEscalationFlaggedAt: Date | null;
  adminEscalationReason: string | null;
  // Set to the super admin's uid when a caretaker takeover happens
  // (PR 5c). Null in normal operation.
  caretakerBy: string | null;
  createdAt: Date | null;
};

function toGroup(snap: QueryDocumentSnapshot): Group {
  const d = snap.data();
  const flag = (d.adminEscalationFlag as AdminEscalationFlag | undefined) ?? null;
  return {
    id: snap.id,
    type: (d.type as GroupType | undefined) ?? "traditional",
    name: (d.name as string | undefined) ?? "",
    description: (d.description as string | undefined) ?? "",
    amount: Number(d.amount ?? 0),
    currency: (d.currency as string | undefined) ?? "CFA",
    frequency: (d.frequency as string | undefined) ?? "Monthly",
    createdBy: (d.createdBy as string | undefined) ?? "",
    status: (d.status as GroupStatus | undefined) ?? "active",
    memberCount: Number(d.memberCount ?? 1),
    currentCycle: (d.currentCycle as number | null | undefined) ?? null,
    positionsLocked: Boolean(d.positionsLocked ?? false),
    adminEscalationFlag: flag,
    adminEscalationFlaggedAt:
      (d.adminEscalationFlaggedAt as Timestamp | undefined)?.toDate() ?? null,
    adminEscalationReason: (d.adminEscalationReason as string | undefined) ?? null,
    caretakerBy: (d.caretakerBy as string | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

// Live-updating stream of all groups, newest first. Same shape as
// FirestoreService.allGroupsStream() in the mobile repo.
export function subscribeGroups(cb: (groups: Group[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(firestore, "groups"), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toGroup)),
    (err) => onError?.(err),
  );
}

// Freeze / resume a group. Mirrors FirestoreService.setGroupStatus in mobile.
export async function setGroupStatus(groupId: string, status: GroupStatus) {
  await updateDoc(doc(firestore, "groups", groupId), { status });
}

// Half-cycle boundary (floor(N/2)). Mirrors GroupModel.halfwayCycle.
export function halfwayCycle(g: Pick<Group, "memberCount">): number {
  return Math.floor(g.memberCount / 2);
}

// Same three-way phase derivation as GroupModel.securedPhase.
export function securedPhase(g: Pick<Group, "type" | "currentCycle" | "memberCount">): SecuredPhase {
  if (g.type !== "secured") return "notStarted";
  const c = g.currentCycle ?? 0;
  if (c <= 0) return "notStarted";
  if (c > g.memberCount) return "closed";
  return c <= halfwayCycle(g) ? "collateral" : "distribution";
}

// Mirrors FirestoreService.transferOwnershipToManager: batch-swaps
// createdBy + roles, and clears the escalation flag atomically.
export async function transferOwnershipToManager(groupId: string): Promise<void> {
  const groupRef = doc(firestore, "groups", groupId);
  const membersCol = collection(firestore, "groups", groupId, "members");

  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const formerAdminUid = groupSnap.data().createdBy as string | undefined;
  if (!formerAdminUid) throw new Error("Group has no admin.");

  const membersSnap = await getDocs(membersCol);
  const managers = membersSnap.docs.filter((d) => d.data().role === "manager");
  if (managers.length === 0) throw new Error("No manager designated for this group.");
  if (managers.length > 1) {
    throw new Error("Multiple managers found — please demote extras before transferring.");
  }
  const managerUid = managers[0].id;
  if (managerUid === formerAdminUid) throw new Error("Manager is already the primary admin.");

  const batch = writeBatch(firestore);
  batch.update(groupRef, {
    createdBy: managerUid,
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });
  batch.update(doc(membersCol, managerUid), { role: "admin" });
  batch.update(doc(membersCol, formerAdminUid), { role: "member" });
  await batch.commit();
}

// Clear an escalation flag without transferring ownership. Useful when the
// super admin has verified a false-positive and wants to dismiss the flag.
export async function clearAdminEscalation(groupId: string): Promise<void> {
  await updateDoc(doc(firestore, "groups", groupId), {
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });
}

// Manually raise the escalation flag from the admin panel. Same shape as
// FirestoreService.flagAdminEscalationIfNeeded writes on the mobile side.
export async function flagAdminEscalation(
  groupId: string,
  flag: AdminEscalationFlag,
  reason: string,
): Promise<void> {
  await updateDoc(doc(firestore, "groups", groupId), {
    adminEscalationFlag: flag,
    adminEscalationFlaggedAt: serverTimestamp(),
    adminEscalationReason: reason,
  });
}

// PR 5c — Super admin becomes the caretaker admin of a group whose primary
// admin (and possibly manager) can no longer serve. Batch writes:
//   • group.createdBy → super admin uid
//   • group.caretakerBy → super admin uid (so surfaces can render a badge)
//   • former admin's role → member
//   • defaulted manager's role → member (only if flag = manager_default or
//     both_default)
//   • super admin's member doc → set with role=admin, caretaker=true,
//     position=memberCount+1 (out of the payout rotation)
//   • escalation flag fields → cleared
// memberCount / memberIds are untouched so the payout math stays intact.
export async function takeOverAsCaretaker(groupId: string): Promise<void> {
  const superAdmin = firebaseAuth.currentUser;
  if (!superAdmin) throw new Error("Not signed in.");

  const groupRef = doc(firestore, "groups", groupId);
  const membersCol = collection(firestore, "groups", groupId, "members");

  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const data = groupSnap.data();
  const formerAdminUid = (data.createdBy as string | undefined) ?? "";
  const memberCount = Number(data.memberCount ?? 1);
  const flag = data.adminEscalationFlag as AdminEscalationFlag | undefined;

  const membersSnap = await getDocs(membersCol);
  const managerDoc = membersSnap.docs.find((d) => d.data().role === "manager");
  const managerUid = managerDoc?.id ?? null;

  const batch = writeBatch(firestore);
  batch.update(groupRef, {
    createdBy: superAdmin.uid,
    caretakerBy: superAdmin.uid,
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });

  if (formerAdminUid && formerAdminUid !== superAdmin.uid) {
    batch.update(doc(membersCol, formerAdminUid), { role: "member" });
  }

  if ((flag === "manager_default" || flag === "both_default") && managerUid) {
    batch.update(doc(membersCol, managerUid), { role: "member" });
  }

  batch.set(doc(membersCol, superAdmin.uid), {
    userId: superAdmin.uid,
    name: superAdmin.displayName || "Pari Support",
    email: superAdmin.email || "",
    role: "admin",
    position: memberCount + 1,
    joinedAt: serverTimestamp(),
    caretaker: true,
  });

  await batch.commit();
}

// PR 6a — Append-only ledger entry per group. Kinds match the four money-flow
// events surfaced by the mobile service. See lib/models/ledger_entry.dart.
export type LedgerKind = "contribution" | "payout" | "refund" | "penalty";
export type LedgerPhase =
  | "active"
  | "notStarted"
  | "collateral"
  | "distribution"
  | "terminal"
  | "closed";

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  phase: LedgerPhase;
  userId: string;
  amount: number;
  currency: string;
  cycleNumber: number;
  recordedBy: string;
  createdAt: Date | null;
  paymentId: string | null;
  note: string | null;
};

function toLedgerEntry(snap: QueryDocumentSnapshot): LedgerEntry {
  const d = snap.data();
  return {
    id: snap.id,
    kind: (d.kind as LedgerKind | undefined) ?? "contribution",
    phase: (d.phase as LedgerPhase | undefined) ?? "active",
    userId: (d.userId as string | undefined) ?? "",
    amount: Number(d.amount ?? 0),
    currency: (d.currency as string | undefined) ?? "CFA",
    cycleNumber: Number(d.cycleNumber ?? 0),
    recordedBy: (d.recordedBy as string | undefined) ?? "",
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
    paymentId: (d.paymentId as string | undefined) ?? null,
    note: (d.note as string | undefined) ?? null,
  };
}

// Live stream of the group's ledger, newest first. Bounded by [max] to keep
// the payload small; the audit UI paginates for older entries.
export function subscribeLedger(
  groupId: string,
  cb: (entries: LedgerEntry[]) => void,
  max: number = 25,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups", groupId, "ledger"),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toLedgerEntry)),
    (err) => onError?.(err),
  );
}

// PR 5c stub — Cancel the group and refund every member. Full implementation
// depends on the append-only ledger from PR 6a (needed to know exactly how
// much each member has contributed) and the money layer from PR 6b–d
// (needed to actually push refunds via Orange Money). Until those land, this
// method throws with a message the UI can surface, so the button exists but
// is honest about being deferred.
export async function cancelAndRefundGroup(groupId: string): Promise<never> {
  void groupId;
  throw new Error(
    "Cancel + refund needs PR 6a (ledger) and PR 6b–d (money layer). Coming soon.",
  );
}
