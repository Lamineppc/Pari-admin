import {
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import {
  groupPotId,
  mockPaymentProvider,
  userWalletId,
} from "./money/mock/mock-payment-provider";
import { writeAudit } from "./audit";
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
  // Which PaymentProvider handles money for this group. Immutable after
  // creation (Firestore rule). Null on legacy groups predating the field
  // — treated as 'orange_money' at read time. See docs/mock_money.md in
  // the mobile repo for the isolation model.
  moneyProvider: "mock" | "orange_money" | null;
  // Flat penalty (in group currency) applied per missed contribution when
  // a member defaults but stays in the group (see demoteDefaultedAdmin).
  // Deducted from the defaulter's Terminal payout and swept to the Pari
  // platform wallet. Defaults to 0 for legacy groups.
  penaltyPerMissedCycle: number;
  useSlots: boolean;
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
    moneyProvider:
      (d.moneyProvider as "mock" | "orange_money" | undefined) ?? null,
    penaltyPerMissedCycle: Number(d.penaltyPerMissedCycle ?? 0),
    useSlots: Boolean(d.useSlots ?? false),
  };
}

/// Falls back to 'orange_money' for legacy groups predating the field so
/// real money is always the safe default.
export function effectiveMoneyProvider(g: Pick<Group, "moneyProvider">): "mock" | "orange_money" {
  return g.moneyProvider ?? "orange_money";
}

export function isMockMoneyGroup(g: Pick<Group, "moneyProvider">): boolean {
  return effectiveMoneyProvider(g) === "mock";
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

// Live-updating stream of a single group. `cb` receives `null` if the
// document does not exist.
export function subscribeGroup(
  groupId: string,
  cb: (group: Group | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(firestore, "groups", groupId),
    (snap) => cb(snap.exists() ? toGroup(snap as QueryDocumentSnapshot) : null),
    (err) => onError?.(err),
  );
}

// Freeze / resume a group. Mirrors FirestoreService.setGroupStatus in mobile.
export async function setGroupStatus(groupId: string, status: GroupStatus) {
  const before = await getDoc(doc(firestore, "groups", groupId));
  const beforeData = before.exists()
    ? (before.data() as { status?: string; moneyProvider?: string })
    : {};
  await updateDoc(doc(firestore, "groups", groupId), { status });
  await writeAudit({
    action: "set_group_status",
    targetType: "group",
    targetId: groupId,
    test: beforeData.moneyProvider === "mock",
    before: { status: beforeData.status ?? null },
    after: { status },
  });
}

/// Set the group's `currentCycle` field to an arbitrary value. Used to
/// unblock rotations stuck on a bad cycle counter after data
/// corruption or manual DB edits. Doesn't touch payment docs — pair
/// with Cycle Correction if the cycles being skipped/rewound also
/// need their contribs voided.
export async function setGroupCurrentCycle(
  groupId: string,
  cycle: number,
): Promise<void> {
  if (!Number.isFinite(cycle) || cycle < 0) {
    throw new Error("Cycle must be a non-negative integer.");
  }
  const ref = doc(firestore, "groups", groupId);
  const before = await getDoc(ref);
  const beforeCycle = (before.data()?.currentCycle as number | null) ?? null;
  await updateDoc(ref, { currentCycle: cycle });
  await writeAudit({
    action: "set_group_current_cycle",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: { currentCycle: beforeCycle },
    after: { currentCycle: cycle },
  });
}

/// Flip `positionsLocked`. Unlocking lets admins reshuffle positions
/// after a rotation has already started; re-locking closes the door.
/// Standalone from the mobile "READY" flow so super-admin can fix
/// stuck onboarding without pretending to be the group admin.
export async function setPositionsLocked(
  groupId: string,
  locked: boolean,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId);
  const before = await getDoc(ref);
  const beforeLocked = Boolean(before.data()?.positionsLocked ?? false);
  await updateDoc(ref, { positionsLocked: locked });
  await writeAudit({
    action: "set_positions_locked",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: { positionsLocked: beforeLocked },
    after: { positionsLocked: locked },
  });
}

/// Re-numbers member positions to a contiguous 1..N sequence based on
/// current sort order (position asc, then joinCycle, then userId).
/// Fixes duplicate or gapped position values that can appear after
/// manual DB edits or interrupted swaps. Not slot-aware — useSlots
/// groups track position on slot docs.
export async function resyncMemberPositions(
  groupId: string,
): Promise<{ updated: number }> {
  const membersCol = collection(firestore, "groups", groupId, "members");
  const snap = await getDocs(membersCol);
  const docs = snap.docs
    .slice()
    .sort((a, b) => {
      const pa = Number(a.data().position ?? 0);
      const pb = Number(b.data().position ?? 0);
      if (pa !== pb) return pa - pb;
      const ja = Number(a.data().joinCycle ?? 1);
      const jb = Number(b.data().joinCycle ?? 1);
      if (ja !== jb) return ja - jb;
      return a.id.localeCompare(b.id);
    });
  const batch = writeBatch(firestore);
  let updated = 0;
  docs.forEach((d, i) => {
    const target = i + 1;
    if (Number(d.data().position ?? 0) !== target) {
      batch.update(d.ref, { position: target });
      updated++;
    }
  });
  if (updated > 0) await batch.commit();
  await writeAudit({
    action: "resync_member_positions",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { updated, total: docs.length },
  });
  return { updated };
}

/// Heal missing slots on a useSlots group: for every member without a
/// corresponding slot in `owners`, add a solo slot at the tail so the
/// rotation is complete again. Mirrors the mobile `healSlotsIfNeeded`.
/// No-op on non-useSlots groups.
export async function healMissingSlots(
  groupId: string,
): Promise<{ added: number }> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.useSlots !== true) return { added: 0 };

  const membersSnap = await getDocs(
    collection(firestore, "groups", groupId, "members"),
  );
  const slotsSnap = await getDocs(
    collection(firestore, "groups", groupId, "slots"),
  );
  const owned = new Set<string>();
  for (const s of slotsSnap.docs) {
    const owners = (s.data().owners as { userId?: string }[] | undefined) ?? [];
    for (const o of owners) if (o.userId) owned.add(o.userId);
  }
  const missing = membersSnap.docs.filter(
    (m) => !owned.has(m.id) && m.data().kicked !== true,
  );
  if (missing.length === 0) return { added: 0 };

  // Non-creator orphans first so the group creator lands at the tail
  // — same convention the mobile heal uses.
  const creator = g.createdBy as string | undefined;
  missing.sort((a, b) => {
    if (a.id === creator) return 1;
    if (b.id === creator) return -1;
    return a.id.localeCompare(b.id);
  });
  const nextPosition = slotsSnap.docs.length + 1;
  const currentCycle = Number(g.currentCycle ?? 1);
  const batch = writeBatch(firestore);
  const slotsCol = collection(firestore, "groups", groupId, "slots");
  missing.forEach((m, i) => {
    const slotRef = doc(slotsCol);
    const memberData = m.data();
    batch.set(slotRef, {
      position: nextPosition + i,
      joinCycle: currentCycle,
      owners: [
        {
          userId: m.id,
          name: memberData.name ?? "",
          share: 1.0,
        },
      ],
      payoutCycle: null,
      pendingSecondary: null,
    });
  });
  await batch.commit();
  await writeAudit({
    action: "heal_missing_slots",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { added: missing.length },
  });
  return { added: missing.length };
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

/** Human phase label for a *specific* cycle number, used for surfaces that
 *  need to describe both the last-completed cycle and the next one. Mirrors
 *  the same halfway-based rule as securedPhase but takes the cycle as
 *  input so callers don't have to fake a group with a swapped
 *  currentCycle. */
export function phaseLabelForCycle(
  g: Pick<Group, "type" | "memberCount">,
  cycleNumber: number,
): string {
  if (g.type !== "secured") return "—";
  if (cycleNumber <= 0) return "Not started";
  if (cycleNumber > g.memberCount) return "Closed";
  if (cycleNumber === g.memberCount) return "Terminal";
  return cycleNumber <= halfwayCycle(g) ? "Phase 1" : "Phase 2";
}

/** Shared helper: given the current members snapshot, compute what the
 *  manager's new "(AdminPromo)" display name should be and which member
 *  should take over the manager slot. Callers apply the writes themselves
 *  (they may be in a batch or a transaction) — this helper only decides.
 *  Kept in one place so transferOwnershipToManager and demoteDefaultedAdmin
 *  can't drift out of sync. */
export function computeManagerPromotion(args: {
  memberDocs: Array<{ id: string; data: () => Record<string, unknown> }>;
  formerAdminUid: string;
  managerUid: string;
}): { renamedName: string; nextManagerUid: string | null } {
  const managerDoc = args.memberDocs.find((d) => d.id === args.managerUid);
  const currentName =
    (managerDoc?.data().name as string | undefined) ?? "Manager";
  const renamedName = currentName.includes("(AdminPromo)")
    ? currentName
    : `${currentName} (AdminPromo)`;

  const nextManagerDoc = args.memberDocs
    .filter((d) => {
      const uid = d.id;
      if (uid === args.formerAdminUid || uid === args.managerUid) return false;
      const data = d.data();
      if (data.kicked) return false;
      const missed1 = Number(data.missedCyclesPhase1 ?? 0);
      const missed2 = Number(data.missedCyclesPhase2 ?? 0);
      return missed1 === 0 && missed2 === 0;
    })
    .sort(
      (a, b) =>
        Number(a.data().position ?? 999) - Number(b.data().position ?? 999),
    )[0];
  const nextManagerUid = nextManagerDoc?.id ?? null;

  return { renamedName, nextManagerUid };
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

  const { renamedName, nextManagerUid } = computeManagerPromotion({
    memberDocs: membersSnap.docs,
    formerAdminUid,
    managerUid,
  });

  const batch = writeBatch(firestore);
  batch.update(groupRef, {
    createdBy: managerUid,
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });
  batch.update(doc(membersCol, managerUid), {
    role: "admin",
    name: renamedName,
  });
  batch.update(doc(firestore, "users", managerUid), {
    name: renamedName,
  });
  batch.update(doc(membersCol, formerAdminUid), { role: "member" });
  if (nextManagerUid) {
    batch.update(doc(membersCol, nextManagerUid), { role: "manager" });
  }
  await batch.commit();
  await writeAudit({
    action: "promote_manager_to_admin",
    targetType: "group",
    targetId: groupId,
    test: (groupSnap.data() as { moneyProvider?: string })?.moneyProvider === "mock",
    before: { createdBy: formerAdminUid, managerRole: "manager", adminRole: "admin" },
    after: { createdBy: managerUid, managerRole: "admin", formerAdminRole: "member" },
  });
}

// Clear an escalation flag without transferring ownership. Useful when the
// super admin has verified a false-positive and wants to dismiss the flag.
export async function clearAdminEscalation(groupId: string): Promise<void> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  const flagBefore = groupSnap.exists()
    ? (groupSnap.data() as { adminEscalationFlag?: string; moneyProvider?: string })
    : {};
  await updateDoc(doc(firestore, "groups", groupId), {
    adminEscalationFlag: deleteField(),
    adminEscalationFlaggedAt: deleteField(),
    adminEscalationReason: deleteField(),
  });
  await writeAudit({
    action: "dismiss_escalation",
    targetType: "group",
    targetId: groupId,
    test: flagBefore.moneyProvider === "mock",
    before: { adminEscalationFlag: flagBefore.adminEscalationFlag ?? null },
    after: { adminEscalationFlag: null },
  });
}

// Manually raise the escalation flag from the admin panel. Same shape as
// FirestoreService.flagAdminEscalationIfNeeded writes on the mobile side.
export async function flagAdminEscalation(
  groupId: string,
  flag: AdminEscalationFlag,
  reason: string,
): Promise<void> {
  const snap = await getDoc(doc(firestore, "groups", groupId));
  await updateDoc(doc(firestore, "groups", groupId), {
    adminEscalationFlag: flag,
    adminEscalationFlaggedAt: serverTimestamp(),
    adminEscalationReason: reason,
  });
  await writeAudit({
    action: "flag_escalation_manual",
    targetType: "group",
    targetId: groupId,
    test: (snap.data() as { moneyProvider?: string })?.moneyProvider === "mock",
    before: { adminEscalationFlag: null },
    after: { adminEscalationFlag: flag },
    reason,
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
  await writeAudit({
    action: "take_over_as_caretaker",
    targetType: "group",
    targetId: groupId,
    test: (data as { moneyProvider?: string })?.moneyProvider === "mock",
    before: { createdBy: formerAdminUid, flag: flag ?? null, managerUid },
    after: { createdBy: superAdmin.uid, caretakerBy: superAdmin.uid, flag: null },
  });
}

// Simulation helper — lets the signed-in super admin drop themselves into
// a mock group as an observer so the mobile app renders the group in their
// "My Groups" tab. Flips isTestAccount to true (mock groups can only host
// test accounts under the membership rule) and adds the uid to memberIds
// so arrayContains queries see it. The new member doc is written outside
// the payout rotation (position 999, role 'member') so simulator math
// isn't disturbed. Idempotent — running twice is a no-op.
export async function addMeAsObserver(groupId: string): Promise<void> {
  const me = firebaseAuth.currentUser;
  if (!me) throw new Error("Not signed in.");

  await updateDoc(doc(firestore, "users", me.uid), { isTestAccount: true });

  const groupRef = doc(firestore, "groups", groupId);
  await updateDoc(groupRef, {
    memberIds: arrayUnion(me.uid),
  });

  const memberRef = doc(firestore, "groups", groupId, "members", me.uid);
  const existing = await getDoc(memberRef);
  if (existing.exists()) return;
  await setDoc(memberRef, {
    userId: me.uid,
    name: me.displayName ?? me.email ?? "Observer",
    email: me.email ?? "",
    role: "member",
    // 999 keeps the observer out of the rotation ordering used by the
    // Secured simulator (which sorts by position).
    position: 999,
    joinedAt: serverTimestamp(),
    observer: true,
  });
  await writeAudit({
    action: "add_me_as_observer",
    targetType: "group",
    targetId: groupId,
    test: true, // only offered on mock groups
    after: { observerUid: me.uid, position: 999, role: "member", observer: true },
  });
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

export type SlotOwnerSummary = {
  userId: string;
  name: string;
  share: number;
};

export type SlotSummary = {
  id: string;
  position: number;
  owners: SlotOwnerSummary[];
  pendingSecondaryUserId: string | null;
  payoutCycle: number | null;
  addedByAdmin: boolean;
};

export function subscribeSlots(
  groupId: string,
  cb: (slots: SlotSummary[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups", groupId, "slots"),
    orderBy("position", "asc"),
  );
  return onSnapshot(
    q,
    (s) =>
      cb(
        s.docs.map((d) => {
          const data = d.data();
          const rawOwners = Array.isArray(data.owners) ? data.owners : [];
          const pending = data.pendingSecondary as { userId?: string } | undefined;
          return {
            id: d.id,
            position: Number(data.position ?? 0),
            owners: rawOwners.map((o) => ({
              userId: String((o as { userId?: unknown })?.userId ?? ""),
              name: String((o as { name?: unknown })?.name ?? ""),
              share: Number((o as { share?: unknown })?.share ?? 0),
            })),
            pendingSecondaryUserId: pending?.userId ?? null,
            payoutCycle:
              typeof data.payoutCycle === "number" ? data.payoutCycle : null,
            addedByAdmin: data.addedByAdmin === true,
          };
        }),
      ),
    (err) => onError?.(err),
  );
}

// ── Members ────────────────────────────────────────────────────────────────

export type MemberRole = "admin" | "manager" | "member";

export type MemberSummary = {
  userId: string;
  name: string;
  role: MemberRole;
  position: number;
  joinCycle: number;
  payoutCycle: number | null;
  kicked: boolean;
};

export function subscribeGroupMembers(
  groupId: string,
  cb: (members: MemberSummary[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups", groupId, "members"),
    orderBy("position", "asc"),
  );
  return onSnapshot(
    q,
    (s) =>
      cb(
        s.docs.map((d) => {
          const data = d.data();
          return {
            userId: d.id,
            name: String(data.name ?? ""),
            role: (data.role as MemberRole | undefined) ?? "member",
            position: Number(data.position ?? 0),
            joinCycle: Number(data.joinCycle ?? 1),
            payoutCycle:
              typeof data.payoutCycle === "number" ? data.payoutCycle : null,
            kicked: data.kicked === true,
          };
        }),
      ),
    (err) => onError?.(err),
  );
}

export type GroupJoinRequest = {
  id: string;
  groupId: string;
  groupName: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  /// "admin" = admin invited this user; awaiting user acceptance.
  /// "user" (or missing) = user asked to join; awaiting admin approval.
  originatedBy: "admin" | "user";
  invitedBy: string | null;
  invitedByName: string | null;
  requestedAt: Date | null;
};

/// Live stream of every pending request under
/// `groups/{groupId}/requests`. Covers both directions — user-initiated
/// join requests and admin-initiated invitations — with the source
/// flagged by `originatedBy`.
export function subscribeGroupPendingRequests(
  groupId: string,
  cb: (requests: GroupJoinRequest[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups", groupId, "requests"),
    where("status", "==", "pending"),
  );
  return onSnapshot(
    q,
    (s) =>
      cb(
        s.docs.map((d) => {
          const data = d.data();
          const originated =
            data.originatedBy === "admin" ? "admin" : "user";
          return {
            id: d.id,
            groupId: (data.groupId as string | undefined) ?? groupId,
            groupName: String(data.groupName ?? ""),
            userId: String(data.userId ?? ""),
            userName: String(data.userName ?? ""),
            userEmail: String(data.userEmail ?? ""),
            status: (data.status as GroupJoinRequest["status"] | undefined) ??
              "pending",
            originatedBy: originated as "admin" | "user",
            invitedBy: (data.invitedBy as string | undefined) ?? null,
            invitedByName: (data.invitedByName as string | undefined) ?? null,
            requestedAt:
              (data.requestedAt as Timestamp | undefined)?.toDate() ?? null,
          };
        }),
      ),
    (err) => onError?.(err),
  );
}

/// Approve a user's request to join [groupId] on behalf of super-admin.
/// Enrolls the user via [enrollMemberInGroup] and marks the request +
/// user-mirror docs approved. Idempotent-ish: safe to retry if the
/// mobile approveRequest partially completed.
export async function approveGroupRequest(
  request: GroupJoinRequest,
): Promise<void> {
  await enrollMemberInGroup({
    groupId: request.groupId,
    userId: request.userId,
    name: request.userName,
    email: request.userEmail,
  });
  const batch = writeBatch(firestore);
  batch.update(
    doc(firestore, "groups", request.groupId, "requests", request.id),
    { status: "approved" },
  );
  batch.set(
    doc(
      firestore,
      "userRequests",
      request.userId,
      "pending",
      request.id,
    ),
    { status: "approved" },
    { merge: true },
  );
  await batch.commit();
  await writeAudit({
    action: "approve_join_request",
    targetType: "group",
    targetId: request.groupId,
    test: false,
    after: {
      userId: request.userId,
      userName: request.userName,
      originatedBy: request.originatedBy,
    },
  });
}

/// Reject a user's join request (or cancel an admin invitation) on
/// behalf of super-admin. Deletes both the group-side doc and the
/// user-side mirror so the invitation disappears from the user's
/// pending list too. `kind` labels the audit entry.
export async function cancelGroupRequest(
  request: GroupJoinRequest,
): Promise<void> {
  const batch = writeBatch(firestore);
  batch.delete(
    doc(firestore, "groups", request.groupId, "requests", request.id),
  );
  batch.delete(
    doc(
      firestore,
      "userRequests",
      request.userId,
      "pending",
      request.id,
    ),
  );
  await batch.commit();
  await writeAudit({
    action:
      request.originatedBy === "admin"
        ? "cancel_group_invitation"
        : "reject_join_request",
    targetType: "group",
    targetId: request.groupId,
    test: false,
    after: {
      userId: request.userId,
      userName: request.userName,
      originatedBy: request.originatedBy,
    },
  });
}

/// Force-accept a pending admin invitation on the invitee's behalf.
/// Same effect as the user tapping Accept in their pending list:
/// enrolls the user, marks both mirrors approved. Only meaningful
/// for `originatedBy: 'admin'` requests; rejects otherwise.
export async function forceAcceptGroupInvitation(
  request: GroupJoinRequest,
): Promise<void> {
  if (request.originatedBy !== "admin") {
    throw new Error("Only admin invitations can be force-accepted.");
  }
  await enrollMemberInGroup({
    groupId: request.groupId,
    userId: request.userId,
    name: request.userName,
    email: request.userEmail,
  });
  const batch = writeBatch(firestore);
  batch.update(
    doc(firestore, "groups", request.groupId, "requests", request.id),
    { status: "approved" },
  );
  batch.set(
    doc(
      firestore,
      "userRequests",
      request.userId,
      "pending",
      request.id,
    ),
    { status: "approved" },
    { merge: true },
  );
  await batch.commit();
  await writeAudit({
    action: "force_accept_group_invitation",
    targetType: "group",
    targetId: request.groupId,
    test: false,
    after: {
      userId: request.userId,
      userName: request.userName,
    },
  });
}

/// Enroll a user into [groupId] on behalf of super-admin. Appends at
/// the tail of the rotation, writes the member doc, bumps
/// memberCount, and — for useSlots groups — adds a solo slot mirroring
/// addSlotForMember. Rejects if the user is already a member.
export async function enrollMemberInGroup(args: {
  groupId: string;
  userId: string;
  name: string;
  email: string;
}): Promise<void> {
  const { groupId, userId, name, email } = args;
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();

  const memberRef = doc(firestore, "groups", groupId, "members", userId);
  const existing = await getDoc(memberRef);
  if (existing.exists()) throw new Error("Already a member of this group.");

  const membersCol = collection(firestore, "groups", groupId, "members");
  const membersSnap = await getDocs(membersCol);
  const position = membersSnap.docs.length + 1;
  const currentCycle = Number(g.currentCycle ?? 1);

  const batch = writeBatch(firestore);
  batch.set(memberRef, {
    userId,
    name,
    email,
    role: "member",
    position,
    joinedAt: serverTimestamp(),
    joinCycle: currentCycle,
  });
  batch.update(groupRef, {
    memberCount: (Number(g.memberCount ?? 0) || membersSnap.docs.length) + 1,
    memberIds: arrayUnion(userId),
  });
  if (g.useSlots === true) {
    const slotsCol = collection(firestore, "groups", groupId, "slots");
    const slotsSnap = await getDocs(slotsCol);
    const slotRef = doc(slotsCol);
    batch.set(slotRef, {
      position: slotsSnap.docs.length + 1,
      joinCycle: currentCycle,
      owners: [{ userId, name, share: 1.0 }],
      payoutCycle: null,
      pendingSecondary: null,
      addedByAdmin: true,
    });
  }
  await batch.commit();
  await writeAudit({
    action: "enroll_member",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { userId, position },
  });
}

/// Super-admin role override on a specific member. No money implication;
/// just flips the `role` field. Downgrading the current admin without
/// promoting someone else first would leave the group orphaned, so callers
/// (the UI) enforce the "promote first, demote after" order — the write
/// itself doesn't police it because a super-admin sometimes needs the
/// override for cleanup.
export async function setMemberRole(
  groupId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId, "members", userId);
  const before = await getDoc(ref);
  const beforeRole = before.data()?.role as MemberRole | undefined;
  await updateDoc(ref, { role });
  await writeAudit({
    action: "set_member_role",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: { userId, role: beforeRole ?? null },
    after: { userId, role },
  });
}

/// Swap the rotation position of two members. Both writes go in one batch
/// so the position field can never briefly duplicate. Not slot-aware yet —
/// caller ensures the group is legacy (members-as-slots). For useSlots
/// groups position lives on the slot doc; PR-1b's slot management will
/// cover that path.
export async function swapMemberPositions(
  groupId: string,
  userIdA: string,
  userIdB: string,
): Promise<void> {
  const membersCol = collection(firestore, "groups", groupId, "members");
  const refA = doc(membersCol, userIdA);
  const refB = doc(membersCol, userIdB);
  const [snapA, snapB] = await Promise.all([getDoc(refA), getDoc(refB)]);
  const posA = snapA.data()?.position as number | undefined;
  const posB = snapB.data()?.position as number | undefined;
  if (typeof posA !== "number" || typeof posB !== "number") {
    throw new Error("Could not resolve both member positions.");
  }
  const batch = writeBatch(firestore);
  batch.update(refA, { position: posB });
  batch.update(refB, { position: posA });
  await batch.commit();
  await writeAudit({
    action: "swap_member_positions",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: { a: { userId: userIdA, position: posA }, b: { userId: userIdB, position: posB } },
    after: { a: { userId: userIdA, position: posB }, b: { userId: userIdB, position: posA } },
  });
}

/// Kick a single member and refund any pending contributions they've
/// already recorded for this cycle or earlier. If the group runs on
/// mock money the pot → user wallet transfer happens inside a
/// transaction; real-money groups throw with a "needs cloud function"
/// message so we never quietly leave money stuck.
///
/// Callers should warn separately if the member has already been paid
/// out (payoutCycle != null) since kicking after a payout doesn't
/// return money to the pot.
export async function kickMember(
  groupId: string,
  userId: string,
): Promise<{ refundAmount: number; voidedPayments: number }> {
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const currency = String(g.currency ?? "CFA");
  const isMock = String(g.moneyProvider ?? "") === "mock";

  // Sum non-voided contributions this member has recorded so far.
  const paymentsCol = collection(firestore, "groups", groupId, "payments");
  const paymentsSnap = await getDocs(
    query(paymentsCol, where("userId", "==", userId)),
  );
  const active = paymentsSnap.docs.filter((d) => {
    const data = d.data();
    return (
      data.type === "contribution" && (data.status as string | undefined) !== "voided"
    );
  });
  let refundAmount = 0;
  for (const d of active) {
    refundAmount += Number(d.data().amount ?? 0);
  }
  if (!isMock && refundAmount > 0) {
    throw new Error(
      "Real-money refunds need the Cloud Function payout path (PR 6b–d). Kicking now would strand the member's contributions in the pot.",
    );
  }

  // Move refund first so an underfunded pot fails before we void anything.
  if (isMock && refundAmount > 0) {
    await mockPaymentProvider.transfer({
      fromWalletId: groupPotId(groupId),
      toWalletId: userWalletId(userId),
      amount: refundAmount,
      purpose: "refund",
      groupId,
      cycleNumber: Number(g.currentCycle ?? 1),
    });
  }

  const batch = writeBatch(firestore);
  for (const d of active) {
    batch.update(d.ref, { status: "voided", voidedAt: serverTimestamp() });
  }
  const memberRef = doc(firestore, "groups", groupId, "members", userId);
  batch.update(memberRef, { kicked: true, kickedAt: serverTimestamp() });
  if (refundAmount > 0) {
    const ledgerRef = doc(
      collection(firestore, "groups", groupId, "ledger"),
      `refund_${userId}_kick_${Date.now()}`,
    );
    batch.set(ledgerRef, {
      kind: "refund",
      userId,
      amount: refundAmount,
      currency,
      cycleNumber: Number(g.currentCycle ?? 1),
      recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
      createdAt: serverTimestamp(),
      note: "Super-admin kick refund",
    });
  }
  await batch.commit();

  await writeAudit({
    action: "kick_member",
    targetType: "group",
    targetId: groupId,
    test: false,
    reason: "Super-admin kick",
    after: { userId, refundAmount, voidedPayments: active.length },
  });

  return { refundAmount, voidedPayments: active.length };
}

/// Full member reset: voids every non-voided payout AND contribution
/// this user has recorded on the group, reverses the corresponding
/// mock-money movements (payout: user wallet → pot; contribution: pot
/// → user wallet), and clears `payoutCycle` on the member doc so they
/// show as unpaid again. Net effect: the member's participation across
/// those cycles is undone and both balance sheets rewind.
///
/// Real-money groups throw — reversals have to run through the Cloud
/// Function. Unlike mobile `unlockPayout`, this does NOT roll back
/// group.currentCycle; super-admin drives that via Cycle Correction if
/// they need it.
export async function resetMemberPayout(
  groupId: string,
  userId: string,
): Promise<{
  voidedPayments: number;
  reversedPayoutAmount: number;
  refundedContribAmount: number;
}> {
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const currency = String(g.currency ?? "CFA");
  const isMock = String(g.moneyProvider ?? "") === "mock";

  const paymentsCol = collection(firestore, "groups", groupId, "payments");
  const snap = await getDocs(query(paymentsCol, where("userId", "==", userId)));
  const activePayouts = snap.docs.filter((d) => {
    const data = d.data();
    return data.type === "payout" && (data.status as string | undefined) !== "voided";
  });
  const activeContribs = snap.docs.filter((d) => {
    const data = d.data();
    return (
      data.type === "contribution" && (data.status as string | undefined) !== "voided"
    );
  });
  if (activePayouts.length === 0 && activeContribs.length === 0) {
    throw new Error("Nothing to reset — no active payout or contribution.");
  }
  let reversedPayoutAmount = 0;
  let cycleNumber = 0;
  for (const d of activePayouts) {
    reversedPayoutAmount += Number(d.data().amount ?? 0);
    cycleNumber = Math.max(cycleNumber, Number(d.data().cycleNumber ?? 0));
  }
  let refundedContribAmount = 0;
  for (const d of activeContribs) {
    refundedContribAmount += Number(d.data().amount ?? 0);
    cycleNumber = Math.max(cycleNumber, Number(d.data().cycleNumber ?? 0));
  }
  if (!isMock) {
    throw new Error(
      "Real-money reset needs the Cloud Function path (PR 6b–d).",
    );
  }

  // Move money first so an underfunded wallet/pot fails before any docs
  // are voided. Payout reversal drains the user's wallet back into the
  // pot; contribution refund does the opposite.
  if (reversedPayoutAmount > 0) {
    await mockPaymentProvider.transfer({
      fromWalletId: userWalletId(userId),
      toWalletId: groupPotId(groupId),
      amount: reversedPayoutAmount,
      purpose: "refund",
      groupId,
      cycleNumber,
    });
  }
  if (refundedContribAmount > 0) {
    await mockPaymentProvider.transfer({
      fromWalletId: groupPotId(groupId),
      toWalletId: userWalletId(userId),
      amount: refundedContribAmount,
      purpose: "refund",
      groupId,
      cycleNumber,
    });
  }

  const batch = writeBatch(firestore);
  for (const d of [...activePayouts, ...activeContribs]) {
    batch.update(d.ref, { status: "voided", voidedAt: serverTimestamp() });
  }
  const memberRef = doc(firestore, "groups", groupId, "members", userId);
  batch.update(memberRef, { payoutCycle: deleteField() });
  if (refundedContribAmount > 0) {
    const ledgerRef = doc(
      collection(firestore, "groups", groupId, "ledger"),
      `refund_${userId}_reset_${Date.now()}`,
    );
    batch.set(ledgerRef, {
      kind: "refund",
      userId,
      amount: refundedContribAmount,
      currency,
      cycleNumber,
      recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
      createdAt: serverTimestamp(),
      note: "Super-admin member reset — contributions refunded",
    });
  }
  await batch.commit();

  await writeAudit({
    action: "reset_member_payout",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: {
      userId,
      reversedPayoutAmount,
      refundedContribAmount,
      voidedPayments: activePayouts.length + activeContribs.length,
      cycleNumber,
    },
  });

  return {
    voidedPayments: activePayouts.length + activeContribs.length,
    reversedPayoutAmount,
    refundedContribAmount,
  };
}

/// Super-admin direct-record of a contribution on behalf of a member.
/// Mirrors the mobile `recordContribution` flow (payment doc + ledger
/// entry + optional mock money transfer) but with the super-admin as
/// recordedBy and no client-side deadline/isLate inference — the
/// caller passes `isLate` and `penaltyAmount` explicitly.
///
/// Legacy (non-useSlots) groups only for now. Split-slot recording
/// lands with the slot-management PR.
export async function recordContributionAsSuperAdmin(args: {
  groupId: string;
  userId: string;
  userName: string;
  cycleNumber: number;
  amount: number;
  isLate: boolean;
  penaltyAmount: number;
  note?: string;
}): Promise<void> {
  const {
    groupId,
    userId,
    userName,
    cycleNumber,
    amount,
    isLate,
    penaltyAmount,
    note,
  } = args;
  if (amount <= 0) throw new Error("Amount must be positive.");
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.useSlots === true) {
    throw new Error(
      "Direct record on split-slot groups lands with the slot-management PR.",
    );
  }
  const currency = String(g.currency ?? "CFA");
  const isMock = String(g.moneyProvider ?? "") === "mock";
  const paymentRef = doc(
    collection(firestore, "groups", groupId, "payments"),
    `${userId}_c${cycleNumber}`,
  );
  const existing = await getDoc(paymentRef);
  if (existing.exists() && (existing.data()?.status as string) !== "voided") {
    throw new Error(`Contribution already recorded for cycle ${cycleNumber}.`);
  }
  if (isMock) {
    await mockPaymentProvider.transfer({
      fromWalletId: userWalletId(userId),
      toWalletId: groupPotId(groupId),
      amount,
      purpose: "contribution",
      groupId,
      cycleNumber,
    });
  }
  const batch = writeBatch(firestore);
  batch.set(paymentRef, {
    cycleNumber,
    userId,
    userName,
    amount,
    currency,
    type: "contribution",
    paidAt: serverTimestamp(),
    recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
    status: "active",
    ...(note ? { note } : {}),
    ...(isLate ? { isLate: true } : {}),
    ...(penaltyAmount > 0 ? { penaltyAmount } : {}),
  });
  const baseAmount = penaltyAmount > 0 ? amount - penaltyAmount : amount;
  const nowMicros = Date.now() * 1000;
  const contribLedger = doc(
    collection(firestore, "groups", groupId, "ledger"),
    `contribution_${userId}_c${cycleNumber}_a${nowMicros}`,
  );
  batch.set(contribLedger, {
    kind: "contribution",
    userId,
    amount: baseAmount,
    currency,
    cycleNumber,
    recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
    createdAt: serverTimestamp(),
    paymentId: paymentRef.id,
    ...(note ? { note } : {}),
  });
  if (penaltyAmount > 0) {
    const penaltyLedger = doc(
      collection(firestore, "groups", groupId, "ledger"),
      `penalty_${userId}_c${cycleNumber}_a${nowMicros + 1}`,
    );
    batch.set(penaltyLedger, {
      kind: "penalty",
      userId,
      amount: penaltyAmount,
      currency,
      cycleNumber,
      recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
      createdAt: serverTimestamp(),
      paymentId: paymentRef.id,
      note: "Super-admin late-payment penalty",
    });
  }
  await batch.commit();
  await writeAudit({
    action: "super_admin_record_contribution",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { userId, cycleNumber, amount, isLate, penaltyAmount },
  });
}

/// Super-admin direct-record of a payout on behalf of a member for the
/// given cycle. Does NOT check the "contributions incomplete" guard so
/// super-admin can push a payout through corrupted state — the warning
/// UI is the safety net. Mock money moves pot → wallet.
export async function recordPayoutAsSuperAdmin(args: {
  groupId: string;
  userId: string;
  userName: string;
  cycleNumber: number;
  amount: number;
  note?: string;
}): Promise<void> {
  const { groupId, userId, userName, cycleNumber, amount, note } = args;
  if (amount <= 0) throw new Error("Amount must be positive.");
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.useSlots === true) {
    throw new Error(
      "Direct record on split-slot groups lands with the slot-management PR.",
    );
  }
  const currency = String(g.currency ?? "CFA");
  const isMock = String(g.moneyProvider ?? "") === "mock";
  if (isMock) {
    await mockPaymentProvider.transfer({
      fromWalletId: groupPotId(groupId),
      toWalletId: userWalletId(userId),
      amount,
      purpose: "payout",
      groupId,
      cycleNumber,
    });
  }
  const batch = writeBatch(firestore);
  const paymentRef = doc(
    collection(firestore, "groups", groupId, "payments"),
  );
  batch.set(paymentRef, {
    cycleNumber,
    userId,
    userName,
    amount,
    currency,
    type: "payout",
    paidAt: serverTimestamp(),
    recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
    status: "active",
    ...(note ? { note } : {}),
  });
  const nowMicros = Date.now() * 1000;
  const ledgerRef = doc(
    collection(firestore, "groups", groupId, "ledger"),
    `payout_${userId}_c${cycleNumber}_a${nowMicros}`,
  );
  batch.set(ledgerRef, {
    kind: "payout",
    userId,
    amount,
    currency,
    cycleNumber,
    recordedBy: firebaseAuth.currentUser?.uid ?? "super_admin",
    createdAt: serverTimestamp(),
    paymentId: paymentRef.id,
    ...(note ? { note } : {}),
  });
  const memberRef = doc(firestore, "groups", groupId, "members", userId);
  batch.update(memberRef, { payoutCycle: cycleNumber });
  await batch.commit();
  await writeAudit({
    action: "super_admin_record_payout",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { userId, cycleNumber, amount },
  });
}

// ── Group settings ────────────────────────────────────────────────────────

export type EditableGroupSettings = {
  name?: string;
  description?: string;
  amount?: number;
  frequency?: string;
  penaltyPerMissedCycle?: number;
};

/// Patch mutable configuration on a group. Fields not present in
/// [patch] are left untouched. Values are validated inline so we don't
/// silently corrupt amount/frequency with garbage input.
export async function updateGroupSettings(
  groupId: string,
  patch: EditableGroupSettings,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId);
  const before = await getDoc(ref);
  if (!before.exists()) throw new Error("Group not found.");
  const beforeData = before.data();

  const write: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error("Name cannot be empty.");
    write.name = v;
  }
  if (patch.description !== undefined) {
    write.description = patch.description.trim();
  }
  if (patch.amount !== undefined) {
    if (!Number.isFinite(patch.amount) || patch.amount <= 0) {
      throw new Error("Amount must be a positive number.");
    }
    write.amount = patch.amount;
  }
  if (patch.frequency !== undefined) {
    const allowed = new Set(["Weekly", "Bi-weekly", "Monthly"]);
    if (!allowed.has(patch.frequency)) {
      throw new Error("Frequency must be Weekly, Bi-weekly, or Monthly.");
    }
    write.frequency = patch.frequency;
  }
  if (patch.penaltyPerMissedCycle !== undefined) {
    if (
      !Number.isFinite(patch.penaltyPerMissedCycle) ||
      patch.penaltyPerMissedCycle < 0
    ) {
      throw new Error("Penalty must be a non-negative number.");
    }
    write.penaltyPerMissedCycle = patch.penaltyPerMissedCycle;
  }
  if (Object.keys(write).length === 0) return;

  await updateDoc(ref, write);
  await writeAudit({
    action: "update_group_settings",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: {
      name: beforeData.name ?? null,
      amount: beforeData.amount ?? null,
      frequency: beforeData.frequency ?? null,
      penaltyPerMissedCycle: beforeData.penaltyPerMissedCycle ?? null,
    },
    after: write,
  });
}

// ── Slot management ────────────────────────────────────────────────────────

/// Append a solo slot at the tail owned by [userId]. Mirrors the
/// `addExtraSlotForMember` admin action on mobile plus the tail-append
/// used by healMissingSlots.
export async function addSlotForMember(
  groupId: string,
  userId: string,
  memberName: string,
): Promise<{ slotId: string; position: number }> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.useSlots !== true) {
    throw new Error("This group does not use slots.");
  }
  const slotsCol = collection(firestore, "groups", groupId, "slots");
  const existing = await getDocs(slotsCol);
  const position = existing.docs.length + 1;
  const currentCycle = Number(g.currentCycle ?? 1);
  const slotRef = doc(slotsCol);
  await setDoc(slotRef, {
    position,
    joinCycle: currentCycle,
    owners: [{ userId, name: memberName, share: 1.0 }],
    payoutCycle: null,
    pendingSecondary: null,
    // Marks the slot as a super-admin extra, so the mirror −slot button
    // knows which slots it's allowed to remove (originals from group
    // creation stay untouchable).
    addedByAdmin: true,
  });
  await writeAudit({
    action: "add_slot_for_member",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { userId, slotId: slotRef.id, position },
  });
  return { slotId: slotRef.id, position };
}

/// Delete a slot and shift the position of every slot that came after
/// it so the rotation stays contiguous. Only allowed on slots that
/// have not been paid out.
export async function removeSlot(
  groupId: string,
  slotId: string,
): Promise<{ removedPosition: number; shifted: number }> {
  const slotsCol = collection(firestore, "groups", groupId, "slots");
  const targetRef = doc(slotsCol, slotId);
  const target = await getDoc(targetRef);
  if (!target.exists()) throw new Error("Slot not found.");
  const targetData = target.data();
  if (targetData.payoutCycle != null) {
    throw new Error("Cannot remove a slot that has already been paid out.");
  }
  const removedPosition = Number(targetData.position ?? 0);
  const allSnap = await getDocs(slotsCol);
  const batch = writeBatch(firestore);
  batch.delete(targetRef);
  let shifted = 0;
  for (const d of allSnap.docs) {
    if (d.id === slotId) continue;
    const p = Number(d.data().position ?? 0);
    if (p > removedPosition) {
      batch.update(d.ref, { position: p - 1 });
      shifted++;
    }
  }
  await batch.commit();
  await writeAudit({
    action: "remove_slot",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { slotId, removedPosition, shifted },
  });
  return { removedPosition, shifted };
}

/// Replace the sole owner of a solo slot. Blocks split slots (they
/// need two-owner logic) and paid-out slots (rewriting owners after a
/// payout leaves the payout doc pointing at the wrong user).
export async function reassignSlotOwner(
  groupId: string,
  slotId: string,
  newUserId: string,
  newUserName: string,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId, "slots", slotId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Slot not found.");
  const data = snap.data();
  const owners =
    (data.owners as { userId?: string; share?: number }[] | undefined) ?? [];
  if (owners.length !== 1 || Number(owners[0]?.share ?? 0) !== 1.0) {
    throw new Error(
      "Owner reassignment only supports solo slots (share=1.0). Split slots need cancel-split first.",
    );
  }
  if (data.payoutCycle != null) {
    throw new Error("Cannot reassign a slot that has already been paid out.");
  }
  await updateDoc(ref, {
    owners: [{ userId: newUserId, name: newUserName, share: 1.0 }],
  });
  await writeAudit({
    action: "reassign_slot_owner",
    targetType: "group",
    targetId: groupId,
    test: false,
    before: { slotId, previousOwner: owners[0]?.userId ?? null },
    after: { slotId, newOwner: newUserId },
  });
}

/// Force-accept a pending split proposal on behalf of the invitee.
/// Converts the sole owner into two half-share owners (original +
/// pendingSecondary) and clears pendingSecondary. Mirrors the client
/// `acceptSlotSplit` path so the resulting shape is identical.
export async function forceAcceptSplit(
  groupId: string,
  slotId: string,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId, "slots", slotId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Slot not found.");
  const data = snap.data();
  const owners =
    (data.owners as { userId?: string; name?: string; share?: number }[] | undefined) ?? [];
  const pending = data.pendingSecondary as
    | { userId?: string; name?: string }
    | null
    | undefined;
  if (!pending?.userId) throw new Error("No pending split on this slot.");
  if (owners.length !== 1 || Number(owners[0]?.share ?? 0) !== 1.0) {
    throw new Error("Split accept requires a solo owner (share=1.0).");
  }
  const existing = owners[0]!;
  await updateDoc(ref, {
    owners: [
      { userId: existing.userId, name: existing.name ?? "", share: 0.5 },
      { userId: pending.userId, name: pending.name ?? "", share: 0.5 },
    ],
    pendingSecondary: null,
  });
  await writeAudit({
    action: "force_accept_split",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: {
      slotId,
      primary: existing.userId,
      secondary: pending.userId,
    },
  });
}

/// Clear a pending split proposal without accepting it. Used when the
/// invitee ignores the request and admin wants the slot to stay solo.
export async function cancelPendingSplit(
  groupId: string,
  slotId: string,
): Promise<void> {
  const ref = doc(firestore, "groups", groupId, "slots", slotId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Slot not found.");
  const pending = snap.data().pendingSecondary as { userId?: string } | null;
  if (!pending?.userId) throw new Error("No pending split on this slot.");
  await updateDoc(ref, { pendingSecondary: null });
  await writeAudit({
    action: "cancel_pending_split",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: { slotId, cancelledSecondary: pending.userId },
  });
}

// ── Payments (contribution + payout docs, incl. voided) ───────────────────

export type PaymentEntry = {
  id: string;
  cycleNumber: number;
  userId: string;
  userName: string;
  amount: number;
  currency: string;
  type: "contribution" | "payout";
  status: string | null;
  paidAt: Date | null;
  isLate: boolean;
  penaltyAmount: number | null;
  slotId: string | null;
  note: string | null;
};

export function subscribeGroupPayments(
  groupId: string,
  cb: (entries: PaymentEntry[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups", groupId, "payments"),
    orderBy("paidAt", "desc"),
  );
  return onSnapshot(
    q,
    (s) =>
      cb(
        s.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            cycleNumber: Number(data.cycleNumber ?? 0),
            userId: String(data.userId ?? ""),
            userName: String(data.userName ?? ""),
            amount: Number(data.amount ?? 0),
            currency: String(data.currency ?? "CFA"),
            type:
              (data.type as "contribution" | "payout" | undefined) ??
              "contribution",
            status: (data.status as string | undefined) ?? null,
            paidAt: (data.paidAt as Timestamp | undefined)?.toDate() ?? null,
            isLate: data.isLate === true,
            penaltyAmount:
              typeof data.penaltyAmount === "number"
                ? data.penaltyAmount
                : null,
            slotId: (data.slotId as string | undefined) ?? null,
            note: (data.note as string | undefined) ?? null,
          };
        }),
      ),
    (err) => onError?.(err),
  );
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

/** Sums a user's Phase 1 contributions from the ledger. Used by
 *  kickDefaultedAdmin to know what to refund. */
async function sumPhase1Contributions(
  groupId: string,
  uid: string,
  halfway: number,
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(firestore, "groups", groupId, "ledger"),
      where("userId", "==", uid),
      where("kind", "==", "contribution"),
    ),
  );
  const paidCycles = new Map<number, number>();
  for (const d of snap.docs) {
    const data = d.data();
    const cn = Number(data.cycleNumber ?? 0);
    if (cn >= 1 && cn <= halfway) {
      // Take max — one 'contribution' entry per user/cycle by doc-id
      // convention, but be defensive.
      paidCycles.set(cn, Math.max(paidCycles.get(cn) ?? 0, Number(data.amount ?? 0)));
    }
  }
  let total = 0;
  for (const v of paidCycles.values()) total += v;
  return total;
}

/** Resolves an active admin_default or both_default escalation by kicking
 *  the delinquent parties, refunding their Phase 1 contributions from the
 *  pot, promoting the manager (admin_default) or having the super admin
 *  take over as caretaker (both_default), and clearing the flag — all in
 *  a single Firestore transaction so partial failures can't split the
 *  world.
 *
 *  Only implemented for mock groups today. Real-money groups throw with
 *  a "needs PR 6b–d" message because the refund would require an Orange
 *  Money payout via Cloud Functions.
 */
export async function kickDefaultedAdmin(groupId: string): Promise<{
  kickedUids: string[];
  refunds: Record<string, number>;
  newAdminUid: string;
  caretaker: boolean;
}> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const flag = g.adminEscalationFlag as AdminEscalationFlag | undefined;
  if (flag !== "admin_default" && flag !== "both_default") {
    throw new Error(
      "This action only resolves admin_default or both_default flags.",
    );
  }
  if ((g.moneyProvider as string | undefined) !== "mock") {
    throw new Error(
      "Kick+refund on real-money groups needs PR 6b–d (Orange Money via Cloud Functions).",
    );
  }
  const adminUid = (g.createdBy as string | undefined) ?? "";
  if (!adminUid) throw new Error("Group has no admin.");
  const memberCount = Number(g.memberCount ?? 1);
  const halfway = Math.floor(memberCount / 2);

  const membersSnap = await getDocs(
    collection(firestore, "groups", groupId, "members"),
  );
  const managerDoc = membersSnap.docs.find(
    (d) => (d.data().role as string | undefined) === "manager",
  );
  const managerUid = managerDoc?.id ?? null;

  const superAdmin = firebaseAuth.currentUser;
  if (!superAdmin) throw new Error("Not signed in.");

  const isBoth = flag === "both_default";
  if (isBoth && !managerUid) {
    throw new Error("both_default requires a manager doc to exist.");
  }
  const takeoverAsCaretaker = isBoth;
  const newAdminUid = takeoverAsCaretaker
    ? superAdmin.uid
    : (managerUid ?? superAdmin.uid);

  // Compute refunds from the ledger BEFORE the transaction — reads inside
  // the tx would need to be tx.get() but Firestore transactions don't
  // support queries. This is safe because the amounts were already committed
  // and are effectively immutable.
  const adminRefund = await sumPhase1Contributions(groupId, adminUid, halfway);
  const managerRefund =
    isBoth && managerUid
      ? await sumPhase1Contributions(groupId, managerUid, halfway)
      : 0;

  const potRef = doc(firestore, "mockWallets", groupPotId(groupId));
  const adminWalletRef = doc(firestore, "mockWallets", userWalletId(adminUid));
  const managerWalletRef =
    isBoth && managerUid
      ? doc(firestore, "mockWallets", userWalletId(managerUid))
      : null;
  const groupRef = doc(firestore, "groups", groupId);
  const membersCol = collection(firestore, "groups", groupId, "members");

  await runTransaction(firestore, async (tx) => {
    // READ PHASE
    const potSnap = await tx.get(potRef);
    const adminSnap = await tx.get(adminWalletRef);
    const managerSnap = managerWalletRef ? await tx.get(managerWalletRef) : null;
    let potBal = Number(potSnap.data()?.balance ?? 0);
    const adminBal = Number(adminSnap.data()?.balance ?? 0);
    const managerBal = managerSnap
      ? Number(managerSnap.data()?.balance ?? 0)
      : 0;
    const currency =
      (potSnap.data()?.currency as string | undefined) ??
      (g.currency as string | undefined) ??
      "CFA";

    if (potBal < adminRefund + managerRefund) {
      throw new Error(
        `Pot has ${currency} ${potBal.toLocaleString()}, needs ${currency} ${(adminRefund + managerRefund).toLocaleString()} to refund defaulted party. Refill the pot first (contributions from other members).`,
      );
    }

    // WRITE PHASE
    // Refund admin
    if (adminRefund > 0) {
      potBal -= adminRefund;
      tx.set(potRef, {
        balance: potBal,
        currency,
        updatedAt: serverTimestamp(),
      });
      tx.set(adminWalletRef, {
        balance: adminBal + adminRefund,
        currency,
        updatedAt: serverTimestamp(),
      });
      // Refund ledger entry
      tx.set(
        doc(
          firestore,
          "groups",
          groupId,
          "ledger",
          `refund_${adminUid}_c${g.currentCycle ?? halfway}`,
        ),
        {
          kind: "refund",
          phase: "collateral",
          userId: adminUid,
          amount: adminRefund,
          currency,
          cycleNumber: g.currentCycle ?? halfway,
          recordedBy: superAdmin.uid,
          createdAt: serverTimestamp(),
          note: `Refund on ${flag} escalation`,
        },
      );
    }

    // Refund manager (both_default only)
    if (isBoth && managerWalletRef && managerUid && managerRefund > 0) {
      potBal -= managerRefund;
      tx.set(potRef, {
        balance: potBal,
        currency,
        updatedAt: serverTimestamp(),
      });
      tx.set(managerWalletRef, {
        balance: managerBal + managerRefund,
        currency,
        updatedAt: serverTimestamp(),
      });
      tx.set(
        doc(
          firestore,
          "groups",
          groupId,
          "ledger",
          `refund_${managerUid}_c${g.currentCycle ?? halfway}`,
        ),
        {
          kind: "refund",
          phase: "collateral",
          userId: managerUid,
          amount: managerRefund,
          currency,
          cycleNumber: g.currentCycle ?? halfway,
          recordedBy: superAdmin.uid,
          createdAt: serverTimestamp(),
          note: `Refund on ${flag} escalation`,
        },
      );
    }

    // Mark defaulted parties kicked + write role changes
    tx.update(doc(membersCol, adminUid), {
      kicked: true,
      kickedAt: serverTimestamp(),
      refundAmount: adminRefund,
      kickReason: `Defaulted on Phase 1 contributions (${flag})`,
      role: "member",
    });
    if (isBoth && managerUid) {
      tx.update(doc(membersCol, managerUid), {
        kicked: true,
        kickedAt: serverTimestamp(),
        refundAmount: managerRefund,
        kickReason: `Defaulted on Phase 1 contributions (${flag})`,
        role: "member",
      });
    }

    // Promote / take over
    if (takeoverAsCaretaker) {
      // Super admin becomes createdBy and gets a caretaker member doc.
      tx.update(groupRef, {
        createdBy: superAdmin.uid,
        caretakerBy: superAdmin.uid,
        adminEscalationFlag: deleteField(),
        adminEscalationFlaggedAt: deleteField(),
        adminEscalationReason: deleteField(),
      });
      tx.set(doc(membersCol, superAdmin.uid), {
        userId: superAdmin.uid,
        name: superAdmin.displayName || "Pari Support",
        email: superAdmin.email || "",
        role: "admin",
        position: memberCount + 1,
        joinedAt: serverTimestamp(),
        caretaker: true,
      });
    } else if (managerUid) {
      // Promote manager to admin.
      tx.update(groupRef, {
        createdBy: managerUid,
        adminEscalationFlag: deleteField(),
        adminEscalationFlaggedAt: deleteField(),
        adminEscalationReason: deleteField(),
      });
      tx.update(doc(membersCol, managerUid), { role: "admin" });
    }
  });

  await writeAudit({
    action: "kick_defaulted_admin",
    targetType: "group",
    targetId: groupId,
    test: true, // kickDefaultedAdmin only runs on mock groups today
    before: { flag, createdBy: adminUid, managerUid },
    after: {
      newAdminUid,
      caretaker: takeoverAsCaretaker,
      kickedUids: isBoth && managerUid ? [adminUid, managerUid] : [adminUid],
      refunds:
        isBoth && managerUid
          ? { [adminUid]: adminRefund, [managerUid]: managerRefund }
          : { [adminUid]: adminRefund },
    },
  });

  return {
    kickedUids: isBoth && managerUid ? [adminUid, managerUid] : [adminUid],
    refunds: isBoth && managerUid
      ? { [adminUid]: adminRefund, [managerUid]: managerRefund }
      : { [adminUid]: adminRefund },
    newAdminUid,
    caretaker: takeoverAsCaretaker,
  };
}

/** Alternative to kickDefaultedAdmin — instead of removing the defaulted
 *  admin, demote them to member, promote the manager to admin (renamed
 *  with an "(AdminPromo)" suffix so the money-flow CSV makes the swap
 *  obvious), auto-promote the next non-defaulted member to manager, and
 *  bump the demoted admin's payoutOrder to the tail of the payout queue.
 *  Their reduced Terminal payout falls out of the simulator's proportional
 *  math — no refund happens here. `both_default` still routes to the
 *  caretaker path via kickDefaultedAdmin because losing both leaders
 *  needs manual super-admin intervention. */
export async function demoteDefaultedAdmin(groupId: string): Promise<{
  demotedUid: string;
  newAdminUid: string;
  newManagerUid: string | null;
}> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const flag = g.adminEscalationFlag as AdminEscalationFlag | undefined;
  if (flag !== "admin_default") {
    throw new Error(
      "This action only handles admin_default flags. For both_default, use Kick + refund (super-admin caretaker takeover).",
    );
  }
  if ((g.moneyProvider as string | undefined) !== "mock") {
    throw new Error(
      "Demote on real-money groups needs the Cloud Functions money layer (PR 6b–d).",
    );
  }
  const adminUid = (g.createdBy as string | undefined) ?? "";
  if (!adminUid) throw new Error("Group has no admin.");

  const membersSnap = await getDocs(
    collection(firestore, "groups", groupId, "members"),
  );
  const managerDoc = membersSnap.docs.find(
    (d) => (d.data().role as string | undefined) === "manager",
  );
  if (!managerDoc) {
    throw new Error(
      "No manager designated — Secured groups require a manager. Assign one before demoting.",
    );
  }
  const managerUid = managerDoc.id;
  const { renamedName, nextManagerUid } = computeManagerPromotion({
    memberDocs: membersSnap.docs,
    formerAdminUid: adminUid,
    managerUid,
  });

  const adminMemberDoc = membersSnap.docs.find((d) => d.id === adminUid);
  const adminPosition = Number(adminMemberDoc?.data().position ?? 0);

  const groupRef = doc(firestore, "groups", groupId);
  const membersCol = collection(firestore, "groups", groupId, "members");

  await runTransaction(firestore, async (tx) => {
    // Demote defaulted admin — role changes to member, payoutOrder goes
    // to the tail so their remaining payouts land at Terminal only.
    tx.update(doc(membersCol, adminUid), {
      role: "member",
      payoutOrder: 1000 + adminPosition,
      demotedAt: serverTimestamp(),
      demotedReason: "Defaulted on Phase 1 contributions (admin_default)",
    });

    // Promote manager to admin with the "(AdminPromo)" rename.
    tx.update(doc(membersCol, managerUid), {
      role: "admin",
      name: renamedName,
    });
    tx.update(doc(firestore, "users", managerUid), {
      name: renamedName,
    });

    if (nextManagerUid) {
      tx.update(doc(membersCol, nextManagerUid), { role: "manager" });
    }

    tx.update(groupRef, {
      createdBy: managerUid,
      adminEscalationFlag: deleteField(),
      adminEscalationFlaggedAt: deleteField(),
      adminEscalationReason: deleteField(),
    });
  });

  await writeAudit({
    action: "demote_defaulted_admin",
    targetType: "group",
    targetId: groupId,
    test: true,
    before: { flag, createdBy: adminUid, managerUid },
    after: {
      demotedUid: adminUid,
      newAdminUid: managerUid,
      newManagerUid: nextManagerUid,
    },
  });

  return {
    demotedUid: adminUid,
    newAdminUid: managerUid,
    newManagerUid: nextManagerUid,
  };
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

/// Reset a group so it can restart from cycle 1 without deleting the
/// roster. Wipes derived state (payments, ledger, position locks,
/// pending requests) and rewinds every cycle field back to its
/// "fresh group" default. Members and slots stay put — this is
/// meant for admin-corrected restarts, not group deletion.
///
/// Preserves anything under `groups/{gid}/archives` (historical
/// records that survive resets).
///
/// Destructive: the audit log records a count summary of what was
/// wiped so operators can reconstruct scope after the fact.
export async function resetGroup(groupId: string): Promise<{
  paymentsDeleted: number;
  ledgerDeleted: number;
  requestsDeleted: number;
  changeRequestsDeleted: number;
  slotsReset: number;
  membersReset: number;
}> {
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) {
    throw new Error("Group not found.");
  }

  const paymentsCol = collection(firestore, "groups", groupId, "payments");
  const ledgerCol = collection(firestore, "groups", groupId, "ledger");
  const requestsCol = collection(firestore, "groups", groupId, "requests");
  const changeRequestsCol = collection(
    firestore,
    "groups",
    groupId,
    "payoutChangeRequests",
  );
  const slotsCol = collection(firestore, "groups", groupId, "slots");
  const membersCol = collection(firestore, "groups", groupId, "members");

  const [
    paymentsSnap,
    ledgerSnap,
    requestsSnap,
    changeRequestsSnap,
    slotsSnap,
    membersSnap,
  ] = await Promise.all([
    getDocs(paymentsCol),
    getDocs(ledgerCol),
    getDocs(requestsCol),
    getDocs(changeRequestsCol),
    getDocs(slotsCol),
    getDocs(membersCol),
  ]);

  // Firestore batches cap at 500 writes; chunk to stay safe.
  const CHUNK = 400;
  const commit = async (
    writes: ((batch: ReturnType<typeof writeBatch>) => void)[],
  ) => {
    for (let i = 0; i < writes.length; i += CHUNK) {
      const b = writeBatch(firestore);
      for (const w of writes.slice(i, i + CHUNK)) w(b);
      await b.commit();
    }
  };

  // 1. Delete all payments + ledger entries.
  await commit([
    ...paymentsSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) =>
      b.delete(d.ref),
    ),
    ...ledgerSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) =>
      b.delete(d.ref),
    ),
  ]);

  // 2. Reset each slot: payoutCycle → null, clear pendingSecondary.
  await commit(
    slotsSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) => {
      b.update(d.ref, {
        payoutCycle: null,
        pendingSecondary: deleteField(),
      });
    }),
  );

  // 3. Reset each member's payoutCycle so legacy consumers agree.
  await commit(
    membersSnap.docs.map((d) => (b: ReturnType<typeof writeBatch>) => {
      b.update(d.ref, { payoutCycle: null });
    }),
  );

  // 4. Clear pending join requests / invitations. Delete BOTH the
  // group-side doc and the user-side mirror so the user's pending
  // list clears too.
  await commit([
    ...requestsSnap.docs.flatMap((d) => {
      const data = d.data();
      const uid = String(data.userId ?? "");
      const writes: ((b: ReturnType<typeof writeBatch>) => void)[] = [
        (b) => b.delete(d.ref),
      ];
      if (uid) {
        writes.push((b) =>
          b.delete(
            doc(firestore, "userRequests", uid, "pending", d.id),
          ),
        );
      }
      return writes;
    }),
  ]);

  // 5. Clear pending payout-position change requests + their user
  // mirrors under userPayoutRequests/{receiverId}/incoming.
  await commit([
    ...changeRequestsSnap.docs.flatMap((d) => {
      const data = d.data();
      const receiverId = String(data.receiverId ?? "");
      const writes: ((b: ReturnType<typeof writeBatch>) => void)[] = [
        (b) => b.delete(d.ref),
      ];
      if (receiverId) {
        writes.push((b) =>
          b.delete(
            doc(
              firestore,
              "userPayoutRequests",
              receiverId,
              "incoming",
              d.id,
            ),
          ),
        );
      }
      return writes;
    }),
  ]);

  // 6. Group doc: rewind cycle state. Uses deleteField for optional
  // fields that don't exist on non-secured groups.
  const groupData = groupSnap.data();
  const groupUpdate: Record<string, unknown> = {
    currentCycle: 1,
    positionsLocked: false,
    status: "active",
  };
  if (groupData?.type === "secured") {
    groupUpdate.currentPhase = "notStarted";
  }
  await updateDoc(groupRef, groupUpdate);

  const summary = {
    paymentsDeleted: paymentsSnap.size,
    ledgerDeleted: ledgerSnap.size,
    requestsDeleted: requestsSnap.size,
    changeRequestsDeleted: changeRequestsSnap.size,
    slotsReset: slotsSnap.size,
    membersReset: membersSnap.size,
  };

  await writeAudit({
    action: "reset_group",
    targetType: "group",
    targetId: groupId,
    test: false,
    after: summary,
  });

  return summary;
}
