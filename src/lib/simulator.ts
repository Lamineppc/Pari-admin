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
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type QueryDocumentSnapshot,
  type Transaction,
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
  escalation?: EscalationDiagnostic;
};

export type RunNextCycleOptions = {
  /** Members who won't contribute this cycle. Used to simulate delinquency
   *  so downstream escalation-flag paths can be exercised. Payouts still
   *  fire on their scheduled cycles regardless. */
  skipMemberIds?: Set<string>;
};

const PLATFORM_WALLET_ID = "platform:pari";

export type EscalationDiagnostic = {
  reason:
    | "group_missing"
    | "not_secured"
    | "flag_already_set"
    | "still_phase_1"
    | "no_admin"
    | "no_delinquency"
    | "flagged";
  currentCycle: number;
  memberCount: number;
  halfway: number;
  phase1CyclesExpected: number;
  adminUid: string;
  managerUid: string | null;
  adminPhase1Paid: number;
  managerPhase1Paid: number | null;
  adminDefaulted: boolean;
  managerDefaulted: boolean;
  flagWritten: "admin_default" | "manager_default" | "both_default" | null;
};

/**
 * TS port of FirestoreService.flagAdminEscalationIfNeeded in the mobile
 * repo. Runs after every simulator cycle so the escalation loop closes
 * on the panel — no more "open the group on the emulator to trigger it".
 * Idempotent: skips if the group already carries a flag or if the group
 * isn't past Phase 1 yet. Returns a diagnostic describing exactly what
 * it decided so callers can surface a helpful message when nothing
 * writes.
 */
export async function runEscalationDetector(
  groupId: string,
): Promise<EscalationDiagnostic> {
  const empty: EscalationDiagnostic = {
    reason: "group_missing",
    currentCycle: 0,
    memberCount: 0,
    halfway: 0,
    phase1CyclesExpected: 0,
    adminUid: "",
    managerUid: null,
    adminPhase1Paid: 0,
    managerPhase1Paid: null,
    adminDefaulted: false,
    managerDefaulted: false,
    flagWritten: null,
  };

  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) return empty;
  const g = groupSnap.data();
  const currentCycle = Number(g.currentCycle ?? 0);
  const memberCount = Number(g.memberCount ?? 1);
  const halfway = Math.floor(memberCount / 2);
  const base = { ...empty, currentCycle, memberCount, halfway, phase1CyclesExpected: halfway };

  if (g.type !== "secured") return { ...base, reason: "not_secured" };
  if (g.adminEscalationFlag) return { ...base, reason: "flag_already_set" };
  if (currentCycle * 2 <= memberCount) return { ...base, reason: "still_phase_1" };
  if (halfway <= 0) return { ...base, reason: "still_phase_1" };
  const adminUid = (g.createdBy as string | undefined) ?? "";
  if (!adminUid) return { ...base, reason: "no_admin" };

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

  const adminPhase1Paid = await phase1PaidCount(adminUid);
  const adminDefaulted = adminPhase1Paid < halfway;
  let managerPhase1Paid: number | null = null;
  let managerDefaulted = false;
  if (managerUid && managerUid !== adminUid) {
    managerPhase1Paid = await phase1PaidCount(managerUid);
    managerDefaulted = managerPhase1Paid < halfway;
  }

  const diagnostic: EscalationDiagnostic = {
    ...base,
    reason: "no_delinquency",
    adminUid,
    managerUid,
    adminPhase1Paid,
    managerPhase1Paid,
    adminDefaulted,
    managerDefaulted,
    flagWritten: null,
  };

  if (!adminDefaulted && !managerDefaulted) return diagnostic;

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
  return { ...diagnostic, reason: "flagged", flagWritten: flag };
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

type WalletState = { balance: number; currency: string };

/** Stages a payment + ledger write on the given transaction. Assumes the
 *  wallet updates are handled separately (we bundle those in bulk after
 *  computing every balance delta). */
function stagePaymentAndLedger(
  tx: Transaction,
  group: Group,
  args: {
    userId: string;
    userName: string;
    position: number;
    amount: number;
    cycleNumber: number;
    ledgerKind: LedgerKind;
    paymentType: "contribution" | "payout";
    note?: string;
  },
) {
  const {
    userId,
    userName,
    position,
    amount,
    cycleNumber,
    ledgerKind,
    paymentType,
    note,
  } = args;
  const paymentId =
    paymentType === "contribution"
      ? `${userId}_c${cycleNumber}`
      : `sim_payout_${userId}_c${cycleNumber}_${ledgerKind}${
          note === "Second half" ? "_h2" : ""
        }`;
  const paymentRef = doc(firestore, "groups", group.id, "payments", paymentId);
  const ledgerId = `${ledgerKind}_${userId}_c${cycleNumber}${
    note === "Second half" ? "_h2" : ""
  }`;
  const ledgerRef = doc(firestore, "groups", group.id, "ledger", ledgerId);

  tx.set(paymentRef, {
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
  tx.set(ledgerRef, {
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
}

/** Runs the next cycle atomically. Every wallet move, /payments write,
 *  /ledger write, member update, and the final group update happen inside
 *  a single Firestore transaction — either all commit or none. Insufficient
 *  balance or any other failure rolls back completely, so we can never
 *  again end up with an inflated pot while currentCycle stays put.
 *
 *  Only reachable when previewNextCycle returned ready. */
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
  void halfwayCycle; // preserved for readability
  const nextCycle = preview.nextCycle;
  const phase = preview.phase;
  const halfPayout = (group.amount * group.memberCount) / 2;

  const groupRef = doc(firestore, "groups", group.id);
  const potRef = doc(firestore, "mockWallets", groupPotId(group.id));
  const platformRef = doc(firestore, "mockWallets", PLATFORM_WALLET_ID);

  // Every wallet doc we might touch: contributors' + all first-half + all
  // second-half recipients' + pot + platform. Deduped by id so we only
  // read each once (transactions require every read up-front).
  const walletIdsToRead = new Set<string>();
  for (const m of active) walletIdsToRead.add(userWalletId(m.id));
  walletIdsToRead.add(groupPotId(group.id));
  walletIdsToRead.add(PLATFORM_WALLET_ID);
  const walletRefs = Array.from(walletIdsToRead).map((wid) => ({
    id: wid,
    ref: doc(firestore, "mockWallets", wid),
  }));

  const result: SimulatorRunResult = await runTransaction(firestore, async (tx) => {
    // ── READ PHASE ────────────────────────────────────────────────────────
    const walletSnaps = await Promise.all(walletRefs.map((w) => tx.get(w.ref)));
    const wallets = new Map<string, WalletState>();
    walletRefs.forEach((w, i) => {
      const data = walletSnaps[i].data();
      wallets.set(w.id, {
        balance: Number(data?.balance ?? 0),
        currency: (data?.currency as string | undefined) ?? group.currency,
      });
    });

    // ── VALIDATION ────────────────────────────────────────────────────────
    for (const m of contributingMembers) {
      const w = wallets.get(userWalletId(m.id))!;
      if (w.balance < group.amount) {
        throw new Error(
          `${m.name} has ${group.currency} ${w.balance.toLocaleString()}, needs ${group.currency} ${group.amount.toLocaleString()}. Top up the wallet in Users, then re-run.`,
        );
      }
    }

    // ── COMPUTE + STAGE WRITES ────────────────────────────────────────────
    // Step 1 — contributions.
    for (const m of contributingMembers) {
      const walletId = userWalletId(m.id);
      const w = wallets.get(walletId)!;
      wallets.set(walletId, { ...w, balance: w.balance - group.amount });
      const pot = wallets.get(groupPotId(group.id))!;
      wallets.set(groupPotId(group.id), {
        ...pot,
        balance: pot.balance + group.amount,
      });
      stagePaymentAndLedger(tx, group, {
        userId: m.id,
        userName: m.name,
        position: m.position ?? 0,
        amount: group.amount,
        cycleNumber: nextCycle,
        ledgerKind: "contribution",
        paymentType: "contribution",
      });
    }

    // Step 2 — first-half payouts (Distribution + Terminal both).
    let firstHalfPayouts = 0;
    if (phase === "distribution" || phase === "terminal") {
      for (const m of preview.firstHalfRecipients) {
        const pot = wallets.get(groupPotId(group.id))!;
        if (pot.balance < halfPayout) {
          throw new Error(
            `Pot has ${group.currency} ${pot.balance.toLocaleString()}, needs ${group.currency} ${halfPayout.toLocaleString()} for ${m.name}'s first-half payout.`,
          );
        }
        wallets.set(groupPotId(group.id), {
          ...pot,
          balance: pot.balance - halfPayout,
        });
        const walletId = userWalletId(m.id);
        const w = wallets.get(walletId)!;
        wallets.set(walletId, { ...w, balance: w.balance + halfPayout });
        stagePaymentAndLedger(tx, group, {
          userId: m.id,
          userName: m.name,
          position: m.position ?? 0,
          amount: halfPayout,
          cycleNumber: nextCycle,
          ledgerKind: "payout",
          paymentType: "payout",
          note: "First half",
        });
        tx.update(doc(firestore, "groups", group.id, "members", m.id), {
          payoutCycle: nextCycle,
        });
        firstHalfPayouts += 1;
      }
    }

    // Step 3 — Terminal: second-halves + leftover split.
    let secondHalfPayouts = 0;
    let leftover: SimulatorRunResult["leftover"];
    const markedCompleted = phase === "terminal";
    if (phase === "terminal") {
      for (const m of active) {
        const pot = wallets.get(groupPotId(group.id))!;
        if (pot.balance < halfPayout) {
          throw new Error(
            `Pot has ${group.currency} ${pot.balance.toLocaleString()}, needs ${group.currency} ${halfPayout.toLocaleString()} for ${m.name}'s second-half payout.`,
          );
        }
        wallets.set(groupPotId(group.id), {
          ...pot,
          balance: pot.balance - halfPayout,
        });
        const walletId = userWalletId(m.id);
        const w = wallets.get(walletId)!;
        wallets.set(walletId, { ...w, balance: w.balance + halfPayout });
        stagePaymentAndLedger(tx, group, {
          userId: m.id,
          userName: m.name,
          position: m.position ?? 0,
          amount: halfPayout,
          cycleNumber: nextCycle,
          ledgerKind: "payout",
          paymentType: "payout",
          note: "Second half",
        });
        secondHalfPayouts += 1;
      }

      const potAfter = wallets.get(groupPotId(group.id))!;
      if (potAfter.balance > 0) {
        const admin = active.find((m) => m.role === "admin");
        const half = potAfter.balance / 2;
        if (admin) {
          const walletId = userWalletId(admin.id);
          const w = wallets.get(walletId)!;
          wallets.set(walletId, { ...w, balance: w.balance + half });
        }
        const platform = wallets.get(PLATFORM_WALLET_ID)!;
        wallets.set(PLATFORM_WALLET_ID, {
          ...platform,
          balance: platform.balance + half,
        });
        wallets.set(groupPotId(group.id), { ...potAfter, balance: 0 });
        leftover = { adminShare: half, platformShare: half };
      }
    }

    // ── PERSIST WALLETS + GROUP UPDATE ────────────────────────────────────
    for (const [walletId, state] of wallets) {
      const ref =
        walletId === PLATFORM_WALLET_ID
          ? platformRef
          : walletId === groupPotId(group.id)
            ? potRef
            : doc(firestore, "mockWallets", walletId);
      tx.set(ref, {
        balance: state.balance,
        currency: state.currency,
        updatedAt: serverTimestamp(),
      });
    }
    tx.update(groupRef, {
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
  });

  // Escalation detector runs OUTSIDE the transaction because it needs to
  // see the committed currentCycle and read /payments docs that were just
  // written. Failure here doesn't roll back the cycle write — the cycle
  // is a success in its own right; the flag is a follow-up.
  const escalation = await runEscalationDetector(group.id);
  return { ...result, escalation };
}
