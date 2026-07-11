// PR 6a follow-up — Secured rotation simulator.
//
// One click per cycle drives an entire Secured group through Collateral,
// Distribution, and Terminal without touching real money. Every operation
// runs the same three-step pattern the mobile flows use:
//   1. Move mock money via MockPaymentProvider.transfer
//   2. Write a /payments doc (marks the "record" event)
//   3. Stage a matching /ledger entry (append-only audit trail)
//
// The simulator is only reachable on groups with moneyProvider === 'mock'
// and type === 'secured'. See docs/mock_money.md in the mobile repo for
// the isolation model.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";
import {
  halfwayCycle,
  isMockMoneyGroup,
  type Group,
  type LedgerKind,
} from "./groups";
import {
  groupPotId,
  mockPaymentProvider,
  userWalletId,
} from "./money/mock/mock-payment-provider";

export type SimulatorMember = {
  id: string;
  name: string;
  position: number | null;
  role: string;
  kicked: boolean;
  payoutCycle: number | null;
  observer: boolean;
};

export type SimulatorPreview = {
  ready: boolean;
  reason?: string;
  nextCycle: number;
  phase: "collateral" | "distribution" | "terminal";
  activeMembers: number;
  activeMembersList: SimulatorMember[];
  firstHalfRecipients: SimulatorMember[];
  secondHalfRecipients: SimulatorMember[];
};

export type SimulatorRunResult = {
  cycleRan: number;
  phase: "collateral" | "distribution" | "terminal";
  contributions: number;
  skipped: number;
  firstHalfPayouts: number;
  secondHalfPayouts: number;
  leftover?: { adminShare: number; platformShare: number };
  markedCompleted: boolean;
  escalationFlagged?: "admin_default" | "manager_default" | "both_default" | null;
};

export type RunNextCycleOptions = {
  /** Members who won't contribute this cycle. Used to simulate delinquency
   *  so downstream escalation-flag paths can be exercised. Payouts still
   *  fire on their scheduled cycles regardless. */
  skipMemberIds?: Set<string>;
};

const PLATFORM_WALLET_ID = "platform:pari";

/**
 * TS port of FirestoreService.flagAdminEscalationIfNeeded in the mobile
 * repo. Runs after every simulator cycle so the escalation loop closes
 * on the panel — no more "open the group on the emulator to trigger it".
 * Idempotent: skips if the group already carries a flag or if the group
 * isn't past Phase 1 yet.
 *
 * Returns the flag that was written (or null if nothing was written).
 */
export async function runEscalationDetector(
  groupId: string,
): Promise<"admin_default" | "manager_default" | "both_default" | null> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) return null;
  const g = groupSnap.data();
  if (g.type !== "secured") return null;
  if (g.adminEscalationFlag) return null;
  const currentCycle = Number(g.currentCycle ?? 0);
  const memberCount = Number(g.memberCount ?? 1);
  if (currentCycle * 2 <= memberCount) return null; // still Phase 1
  const halfway = Math.floor(memberCount / 2);
  if (halfway <= 0) return null;
  const adminUid = (g.createdBy as string | undefined) ?? "";
  if (!adminUid) return null;

  const managersSnap = await getDocs(
    query(
      collection(firestore, "groups", groupId, "members"),
      where("role", "==", "manager"),
    ),
  );
  const managerUid = managersSnap.empty ? null : managersSnap.docs[0].id;

  async function phase1PaidCount(uid: string): Promise<number> {
    const snap = await getDocs(
      query(
        collection(firestore, "groups", groupId, "payments"),
        where("userId", "==", uid),
      ),
    );
    const paidCycles = new Set<number>();
    for (const d of snap.docs) {
      const data = d.data();
      if ((data.type as string | undefined) !== "contribution") continue;
      if (data.status === "voided") continue;
      const cn = Number(data.cycleNumber ?? 0);
      if (cn >= 1 && cn <= halfway) paidCycles.add(cn);
    }
    return paidCycles.size;
  }

  const adminPaid = await phase1PaidCount(adminUid);
  const adminDefaulted = adminPaid < halfway;
  let managerDefaulted = false;
  if (managerUid && managerUid !== adminUid) {
    const managerPaid = await phase1PaidCount(managerUid);
    managerDefaulted = managerPaid < halfway;
  }
  if (!adminDefaulted && !managerDefaulted) return null;

  const flag =
    adminDefaulted && managerDefaulted
      ? "both_default"
      : adminDefaulted
        ? "admin_default"
        : "manager_default";
  const reason =
    adminDefaulted && managerDefaulted
      ? "Both the primary admin and the manager missed Phase 1 contributions."
      : adminDefaulted
        ? "Primary admin missed at least one Phase 1 contribution."
        : "Designated manager missed at least one Phase 1 contribution.";

  await updateDoc(doc(firestore, "groups", groupId), {
    adminEscalationFlag: flag,
    adminEscalationFlaggedAt: serverTimestamp(),
    adminEscalationReason: reason,
  });
  return flag;
}

function toMember(snap: QueryDocumentSnapshot): SimulatorMember {
  const d = snap.data();
  return {
    id: snap.id,
    name: (d.name as string | undefined) ?? "Member",
    position: (d.position as number | undefined) ?? null,
    role: (d.role as string | undefined) ?? "member",
    kicked: Boolean(d.kicked ?? false),
    payoutCycle: (d.payoutCycle as number | undefined) ?? null,
    observer: Boolean(d.observer ?? false),
  };
}

function phaseForCycle(group: Pick<Group, "type" | "memberCount">, cycle: number): string {
  if (group.type !== "secured") return "active";
  if (cycle <= 0) return "notStarted";
  if (cycle > group.memberCount) return "closed";
  if (cycle === group.memberCount) return "terminal";
  const halfway = halfwayCycle(group);
  return cycle <= halfway ? "collateral" : "distribution";
}

/** Positions receiving first-half payouts in a given Distribution cycle.
 *  For cycle X in Phase 2 (X > halfway), positions are (2*(X-halfway) - 1)
 *  and (2*(X-halfway)). Positions greater than memberCount are dropped
 *  (odd-N tail). */
function firstHalfPositionsForCycle(nextCycle: number, group: Pick<Group, "memberCount">): number[] {
  const halfway = halfwayCycle(group);
  if (nextCycle <= halfway) return [];
  const base = nextCycle - halfway;
  return [2 * base - 1, 2 * base].filter((p) => p <= group.memberCount);
}

async function loadContext(groupId: string): Promise<{ group: Group; members: SimulatorMember[] }> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const group: Group = {
    id: groupSnap.id,
    type: (g.type as Group["type"] | undefined) ?? "traditional",
    name: (g.name as string | undefined) ?? "",
    description: (g.description as string | undefined) ?? "",
    amount: Number(g.amount ?? 0),
    currency: (g.currency as string | undefined) ?? "CFA",
    frequency: (g.frequency as string | undefined) ?? "Monthly",
    createdBy: (g.createdBy as string | undefined) ?? "",
    status: (g.status as Group["status"] | undefined) ?? "active",
    memberCount: Number(g.memberCount ?? 1),
    currentCycle: (g.currentCycle as number | null | undefined) ?? null,
    positionsLocked: Boolean(g.positionsLocked ?? false),
    adminEscalationFlag: null,
    adminEscalationFlaggedAt: null,
    adminEscalationReason: null,
    caretakerBy: null,
    createdAt: null,
    moneyProvider: (g.moneyProvider as Group["moneyProvider"] | undefined) ?? null,
  };

  const membersSnap = await getDocs(collection(firestore, "groups", groupId, "members"));
  const members = membersSnap.docs.map(toMember);
  return { group, members };
}

/** Describes what the next click will do without running anything. */
export async function previewNextCycle(groupId: string): Promise<SimulatorPreview> {
  const { group, members } = await loadContext(groupId);

  if (!isMockMoneyGroup(group)) {
    return { ready: false, reason: "Simulator only runs on mock groups.", nextCycle: 0, phase: "collateral", activeMembers: 0, activeMembersList: [], firstHalfRecipients: [], secondHalfRecipients: [] };
  }
  if (group.type !== "secured") {
    return { ready: false, reason: "Simulator only runs on Secured groups.", nextCycle: 0, phase: "collateral", activeMembers: 0, activeMembersList: [], firstHalfRecipients: [], secondHalfRecipients: [] };
  }
  const currentCycle = group.currentCycle ?? 0;
  const nextCycle = currentCycle + 1;
  if (currentCycle >= group.memberCount) {
    return { ready: false, reason: "Rotation already complete.", nextCycle, phase: "terminal", activeMembers: 0, activeMembersList: [], firstHalfRecipients: [], secondHalfRecipients: [] };
  }

  // Observers (position 999, observer flag) are dropped in from the panel's
  // "Add me as observer" action so a real user can see the group in the
  // mobile app without joining the rotation. Simulator ignores them.
  const active = members.filter((m) => !m.kicked && !m.observer);
  const halfway = halfwayCycle(group);
  const phase: "collateral" | "distribution" | "terminal" =
    nextCycle === group.memberCount
      ? "terminal"
      : nextCycle > halfway
        ? "distribution"
        : "collateral";

  const firstHalfPositions = firstHalfPositionsForCycle(nextCycle, group);
  const firstHalfRecipients = firstHalfPositions
    .map((p) => active.find((m) => m.position === p))
    .filter((m): m is SimulatorMember => !!m);

  const secondHalfRecipients = phase === "terminal" ? active : [];

  const membersWithoutPositions = active.filter((m) => m.position == null);
  const activeMembersList = [...active].sort(
    (a, b) => (a.position ?? 999) - (b.position ?? 999),
  );
  if (membersWithoutPositions.length > 0) {
    return {
      ready: false,
      reason: `${membersWithoutPositions.length} member(s) have no position assigned — lock positions in the mobile app first.`,
      nextCycle,
      phase,
      activeMembers: active.length,
      activeMembersList,
      firstHalfRecipients,
      secondHalfRecipients,
    };
  }

  return {
    ready: true,
    nextCycle,
    phase,
    activeMembers: active.length,
    activeMembersList,
    firstHalfRecipients,
    secondHalfRecipients,
  };
}

async function simTransferAndLog(
  group: Group,
  args: {
    fromWalletId: string;
    toWalletId: string;
    amount: number;
    userId: string;
    userName: string;
    position: number;
    cycleNumber: number;
    ledgerKind: LedgerKind;
    paymentType: "contribution" | "payout";
    note?: string;
  },
) {
  const {
    fromWalletId,
    toWalletId,
    amount,
    userId,
    userName,
    position,
    cycleNumber,
    ledgerKind,
    paymentType,
    note,
  } = args;
  if (amount <= 0) return;

  await mockPaymentProvider.transfer({
    fromWalletId,
    toWalletId,
    amount,
    purpose: ledgerKind,
    groupId: group.id,
    cycleNumber,
    note,
  });

  const paymentId =
    paymentType === "contribution"
      ? `${userId}_c${cycleNumber}`
      : `sim_payout_${userId}_c${cycleNumber}_${ledgerKind}`;
  const paymentRef = doc(firestore, "groups", group.id, "payments", paymentId);
  const ledgerId = `${ledgerKind}_${userId}_c${cycleNumber}`;
  const ledgerRef = doc(firestore, "groups", group.id, "ledger", ledgerId);

  const batch = writeBatch(firestore);
  batch.set(paymentRef, {
    cycleNumber,
    userId,
    userName,
    amount,
    currency: group.currency,
    type: paymentType,
    paidAt: serverTimestamp(),
    recordedBy: firebaseAuth.currentUser?.uid ?? "simulator",
    position,
    simulated: true,
    ...(note ? { note } : {}),
  });
  batch.set(ledgerRef, {
    kind: ledgerKind,
    phase: phaseForCycle(group, cycleNumber),
    userId,
    amount,
    currency: group.currency,
    cycleNumber,
    recordedBy: firebaseAuth.currentUser?.uid ?? "simulator",
    createdAt: serverTimestamp(),
    paymentId,
    ...(note ? { note } : {}),
  });
  await batch.commit();
}

/** Runs the next cycle. Only reachable when previewNextCycle returned ready. */
export async function runNextCycle(
  groupId: string,
  options: RunNextCycleOptions = {},
): Promise<SimulatorRunResult> {
  const preview = await previewNextCycle(groupId);
  if (!preview.ready) throw new Error(preview.reason ?? "Simulator not ready.");
  const { group, members } = await loadContext(groupId);
  const active = members.filter(
    (m) => !m.kicked && !m.observer && m.position != null,
  );
  const skipSet = options.skipMemberIds ?? new Set<string>();
  const contributingMembers = active.filter((m) => !skipSet.has(m.id));
  const skipped = active.length - contributingMembers.length;
  void halfwayCycle; // preserved for readability; unused after simplification
  const nextCycle = preview.nextCycle;
  const phase = preview.phase;
  const halfPayout = (group.amount * group.memberCount) / 2;

  // Pre-flight — read every contributor's balance up-front and abort
  // before we've done any writes if any wallet is short. Without this,
  // a mid-cycle failure would leave partial contributions committed
  // while currentCycle stayed unchanged, silently inflating the pot on
  // every retry. Real Orange Money will need a more robust rollback via
  // Cloud Functions in PR 6b–d; for the mock this cheap check catches
  // 100% of insufficient-balance errors.
  await Promise.all(
    contributingMembers.map(async (m) => {
      const balance = await mockPaymentProvider.balanceFor(userWalletId(m.id));
      if (balance < group.amount) {
        throw new Error(
          `${m.name} has ${group.currency} ${balance.toLocaleString()}, needs ${group.currency} ${group.amount.toLocaleString()}. Top up the wallet in Users, then re-run.`,
        );
      }
    }),
  );

  // Step 1 — every non-skipped active member contributes C. Skipped members
  // are silently omitted so a subsequent flagAdminEscalationIfNeeded pass
  // (from the mobile client's group-open) will observe a missed cycle.
  for (const m of contributingMembers) {
    await simTransferAndLog(group, {
      fromWalletId: userWalletId(m.id),
      toWalletId: groupPotId(group.id),
      amount: group.amount,
      userId: m.id,
      userName: m.name,
      position: m.position ?? 0,
      cycleNumber: nextCycle,
      ledgerKind: "contribution",
      paymentType: "contribution",
    });
  }

  // Step 2 — Phase 2 first-half payouts (also runs on the Terminal cycle
  // because Terminal shares the last Distribution cycle's month).
  let firstHalfPayouts = 0;
  if (phase === "distribution" || phase === "terminal") {
    for (const m of preview.firstHalfRecipients) {
      await simTransferAndLog(group, {
        fromWalletId: groupPotId(group.id),
        toWalletId: userWalletId(m.id),
        amount: halfPayout,
        userId: m.id,
        userName: m.name,
        position: m.position ?? 0,
        cycleNumber: nextCycle,
        ledgerKind: "payout",
        paymentType: "payout",
        note: "First half",
      });
      await updateDoc(doc(firestore, "groups", group.id, "members", m.id), {
        payoutCycle: nextCycle,
      });
      firstHalfPayouts += 1;
    }
  }

  // Step 3 — Terminal: everyone remaining receives their second half, then
  // any residual pot is split 50/50 admin + platform.
  let secondHalfPayouts = 0;
  let leftover: SimulatorRunResult["leftover"];
  const markedCompleted = phase === "terminal";
  if (phase === "terminal") {
    for (const m of active) {
      await simTransferAndLog(group, {
        fromWalletId: groupPotId(group.id),
        toWalletId: userWalletId(m.id),
        amount: halfPayout,
        userId: m.id,
        userName: m.name,
        position: m.position ?? 0,
        cycleNumber: nextCycle,
        // Second half reuses 'payout' as the ledger kind — 'terminal_payout'
        // isn't in the kind whitelist. The doc ID prefix distinguishes it
        // from the first half.
        ledgerKind: "payout",
        paymentType: "payout",
        note: "Second half",
      });
      secondHalfPayouts += 1;
    }

    const potBalance = await mockPaymentProvider.balanceFor(groupPotId(group.id));
    if (potBalance > 0) {
      const admin = active.find((m) => m.role === "admin");
      const half = potBalance / 2;
      if (admin) {
        await mockPaymentProvider.transfer({
          fromWalletId: groupPotId(group.id),
          toWalletId: userWalletId(admin.id),
          amount: half,
          purpose: "refund",
          groupId: group.id,
          cycleNumber: nextCycle,
          note: "Terminal — admin share of pot leftover",
        });
      }
      await mockPaymentProvider.transfer({
        fromWalletId: groupPotId(group.id),
        toWalletId: PLATFORM_WALLET_ID,
        amount: half,
        purpose: "refund",
        groupId: group.id,
        cycleNumber: nextCycle,
        note: "Terminal — platform share of pot leftover",
      });
      leftover = { adminShare: half, platformShare: half };
    }
  }

  await updateDoc(doc(firestore, "groups", group.id), {
    currentCycle: nextCycle,
    positionsLocked: true,
    ...(markedCompleted ? { status: "completed" } : {}),
  });

  // Auto-run the escalation detector after every cycle. It no-ops for Phase 1
  // cycles and for groups whose flag is already set, so the cost is one
  // group-doc read most of the time. Closes the flag loop on the panel
  // without needing the mobile app to open the group.
  const escalationFlagged = await runEscalationDetector(group.id).catch(() => null);

  return {
    cycleRan: nextCycle,
    phase,
    contributions: contributingMembers.length,
    skipped,
    firstHalfPayouts,
    secondHalfPayouts,
    leftover,
    markedCompleted,
    escalationFlagged,
  };
}
