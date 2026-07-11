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
  serverTimestamp,
  updateDoc,
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
};

export type RunNextCycleOptions = {
  /** Members who won't contribute this cycle. Used to simulate delinquency
   *  so downstream escalation-flag paths can be exercised. Payouts still
   *  fire on their scheduled cycles regardless. */
  skipMemberIds?: Set<string>;
};

const PLATFORM_WALLET_ID = "platform:pari";

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

  return {
    cycleRan: nextCycle,
    phase,
    contributions: contributingMembers.length,
    skipped,
    firstHalfPayouts,
    secondHalfPayouts,
    leftover,
    markedCompleted,
  };
}
