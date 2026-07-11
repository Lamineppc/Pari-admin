// Money-flow report per group — deep view of everything the ledger says
// about how money moved through this rotation. Rolls up totals by kind,
// per-member balances, per-cycle deltas, and reconciles the computed pot
// balance against the actual mock-wallet balance (real Orange Money groups
// skip the wallet check since Cloud Functions hold state).

import {
  collection,
  doc,
  getDoc,
  getDocs,
  type Timestamp,
} from "firebase/firestore";
import { firestore } from "./firebase";
import { halfwayCycle } from "./groups";
import {
  groupPotId,
  mockPaymentProvider,
} from "./money/mock/mock-payment-provider";

export type LedgerKind = "contribution" | "payout" | "refund" | "penalty";

type LedgerRow = {
  kind: LedgerKind;
  phase: string;
  userId: string;
  amount: number;
  currency: string;
  cycleNumber: number;
  createdAt: Date | null;
  note: string | null;
};

export type MoneyFlowMember = {
  userId: string;
  userName: string;
  role: string;
  position: number | null;
  kicked: boolean;
  contributed: number;
  paidPenalty: number;
  receivedPayout: number;
  receivedRefund: number;
  net: number;
};

export type MoneyFlowCycle = {
  cycleNumber: number;
  phase: string;
  contributionsIn: number;
  penaltiesIn: number;
  payoutsOut: number;
  refundsOut: number;
  potBalanceAfter: number;
};

export type MoneyFlowReport = {
  groupId: string;
  groupName: string;
  currency: string;
  memberCount: number;
  currentCycle: number;
  halfwayCycle: number;
  moneyProvider: "mock" | "orange_money" | null;

  totals: {
    contributions: { amount: number; count: number };
    payouts: { amount: number; count: number };
    refunds: { amount: number; count: number };
    penalties: { amount: number; count: number };
  };

  computedPotBalance: number;
  actualPotBalance: number | null;
  potDiscrepancy: number | null;

  members: MoneyFlowMember[];
  cycles: MoneyFlowCycle[];

  computedAt: Date;
};

/**
 * Loads a group's ledger + members + optional mock pot balance and rolls
 * everything up into a MoneyFlowReport. Client-side — fine for the panel's
 * scale. If any group's ledger grows past ~5k entries, this'll need
 * pagination or a server-side aggregation.
 */
export async function computeMoneyFlow(groupId: string): Promise<MoneyFlowReport> {
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  const currency = (g.currency as string | undefined) ?? "CFA";
  const memberCount = Number(g.memberCount ?? 1);
  const currentCycle = Number(g.currentCycle ?? 0);
  const moneyProvider =
    (g.moneyProvider as MoneyFlowReport["moneyProvider"]) ?? null;
  const halfway = halfwayCycle({ memberCount });

  const [membersSnap, ledgerSnap] = await Promise.all([
    getDocs(collection(firestore, "groups", groupId, "members")),
    getDocs(collection(firestore, "groups", groupId, "ledger")),
  ]);

  const membersByUid = new Map<
    string,
    {
      userId: string;
      userName: string;
      role: string;
      position: number | null;
      kicked: boolean;
    }
  >();
  for (const d of membersSnap.docs) {
    const data = d.data();
    membersByUid.set(d.id, {
      userId: d.id,
      userName: (data.name as string | undefined) ?? d.id,
      role: (data.role as string | undefined) ?? "member",
      position: (data.position as number | undefined) ?? null,
      kicked: Boolean(data.kicked ?? false),
    });
  }

  const rows: LedgerRow[] = ledgerSnap.docs.map((d) => {
    const data = d.data();
    return {
      kind: (data.kind as LedgerKind | undefined) ?? "contribution",
      phase: (data.phase as string | undefined) ?? "active",
      userId: (data.userId as string | undefined) ?? "",
      amount: Number(data.amount ?? 0),
      currency: (data.currency as string | undefined) ?? currency,
      cycleNumber: Number(data.cycleNumber ?? 0),
      createdAt:
        (data.createdAt as Timestamp | undefined)?.toDate() ?? null,
      note: (data.note as string | undefined) ?? null,
    };
  });

  const totals = {
    contributions: { amount: 0, count: 0 },
    payouts: { amount: 0, count: 0 },
    refunds: { amount: 0, count: 0 },
    penalties: { amount: 0, count: 0 },
  };

  const perMember = new Map<
    string,
    Omit<MoneyFlowMember, "userName" | "role" | "position" | "kicked">
  >();
  function ensureMember(uid: string) {
    if (!perMember.has(uid)) {
      perMember.set(uid, {
        userId: uid,
        contributed: 0,
        paidPenalty: 0,
        receivedPayout: 0,
        receivedRefund: 0,
        net: 0,
      });
    }
    return perMember.get(uid)!;
  }

  const perCycle = new Map<
    number,
    Omit<MoneyFlowCycle, "phase" | "potBalanceAfter">
  >();
  function ensureCycle(cn: number) {
    if (!perCycle.has(cn)) {
      perCycle.set(cn, {
        cycleNumber: cn,
        contributionsIn: 0,
        penaltiesIn: 0,
        payoutsOut: 0,
        refundsOut: 0,
      });
    }
    return perCycle.get(cn)!;
  }

  for (const r of rows) {
    const m = ensureMember(r.userId);
    const c = ensureCycle(r.cycleNumber);
    switch (r.kind) {
      case "contribution":
        totals.contributions.amount += r.amount;
        totals.contributions.count += 1;
        m.contributed += r.amount;
        c.contributionsIn += r.amount;
        break;
      case "penalty":
        totals.penalties.amount += r.amount;
        totals.penalties.count += 1;
        m.paidPenalty += r.amount;
        c.penaltiesIn += r.amount;
        break;
      case "payout":
        totals.payouts.amount += r.amount;
        totals.payouts.count += 1;
        m.receivedPayout += r.amount;
        c.payoutsOut += r.amount;
        break;
      case "refund":
        totals.refunds.amount += r.amount;
        totals.refunds.count += 1;
        m.receivedRefund += r.amount;
        c.refundsOut += r.amount;
        break;
    }
  }

  // Compose per-member with metadata + net.
  const members: MoneyFlowMember[] = [];
  const seen = new Set<string>();
  for (const [uid, agg] of perMember) {
    const meta = membersByUid.get(uid);
    seen.add(uid);
    members.push({
      userId: uid,
      userName: meta?.userName ?? uid,
      role: meta?.role ?? "unknown",
      position: meta?.position ?? null,
      kicked: meta?.kicked ?? false,
      contributed: agg.contributed,
      paidPenalty: agg.paidPenalty,
      receivedPayout: agg.receivedPayout,
      receivedRefund: agg.receivedRefund,
      net: agg.receivedPayout + agg.receivedRefund - agg.contributed - agg.paidPenalty,
    });
  }
  // Add members that appear in members collection but never in the ledger.
  for (const [uid, meta] of membersByUid) {
    if (seen.has(uid)) continue;
    members.push({
      userId: uid,
      userName: meta.userName,
      role: meta.role,
      position: meta.position,
      kicked: meta.kicked,
      contributed: 0,
      paidPenalty: 0,
      receivedPayout: 0,
      receivedRefund: 0,
      net: 0,
    });
  }
  members.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  // Compose per-cycle with phase + running pot balance.
  const sortedCycles = [...perCycle.values()].sort(
    (a, b) => a.cycleNumber - b.cycleNumber,
  );
  const cycles: MoneyFlowCycle[] = [];
  let runningPot = 0;
  for (const c of sortedCycles) {
    const delta =
      c.contributionsIn + c.penaltiesIn - c.payoutsOut - c.refundsOut;
    runningPot += delta;
    const phase =
      c.cycleNumber <= 0
        ? "notStarted"
        : c.cycleNumber > memberCount
          ? "closed"
          : c.cycleNumber === memberCount
            ? "terminal"
            : c.cycleNumber <= halfway
              ? "collateral"
              : "distribution";
    cycles.push({
      cycleNumber: c.cycleNumber,
      phase,
      contributionsIn: c.contributionsIn,
      penaltiesIn: c.penaltiesIn,
      payoutsOut: c.payoutsOut,
      refundsOut: c.refundsOut,
      potBalanceAfter: runningPot,
    });
  }

  const computedPotBalance =
    totals.contributions.amount +
    totals.penalties.amount -
    totals.payouts.amount -
    totals.refunds.amount;

  let actualPotBalance: number | null = null;
  let potDiscrepancy: number | null = null;
  if (moneyProvider === "mock") {
    try {
      actualPotBalance = await mockPaymentProvider.balanceFor(
        groupPotId(groupId),
      );
      potDiscrepancy = actualPotBalance - computedPotBalance;
    } catch {
      // wallet doc missing → treat as zero
      actualPotBalance = 0;
      potDiscrepancy = -computedPotBalance;
    }
  }

  return {
    groupId,
    groupName: (g.name as string | undefined) ?? groupId,
    currency,
    memberCount,
    currentCycle,
    halfwayCycle: halfway,
    moneyProvider,
    totals,
    computedPotBalance,
    actualPotBalance,
    potDiscrepancy,
    members,
    cycles,
    computedAt: new Date(),
  };
}
