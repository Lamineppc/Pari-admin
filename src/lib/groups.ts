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
import { groupPotId, userWalletId } from "./money/mock/mock-payment-provider";
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
