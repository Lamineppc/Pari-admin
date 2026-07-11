// Cycle-correction service — TS port of FirestoreService.wipeCycleData in
// the mobile repo. Deletes every payment record for a specific cycle,
// clears payoutCycle on any member who was paid that cycle, and rolls
// group.currentCycle back to that number. Runs as one Firestore batch so
// partial failures roll back.

import {
  collection,
  doc,
  deleteField,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";
import { writeAudit } from "./audit";

export type PaymentModel = {
  id: string;
  cycleNumber: number;
  userId: string;
  userName: string;
  amount: number;
  currency: string;
  type: "contribution" | "payout";
  status: string | null;
  isLate: boolean;
  penaltyAmount?: number;
  position?: number;
  recordedBy: string;
  note: string | null;
};

/** Loads every payment record for [groupId] on [cycleNumber]. Used by the
 *  preview step so the super admin sees exactly what will be deleted
 *  before they type the confirmation. */
export async function loadCyclePayments(
  groupId: string,
  cycleNumber: number,
): Promise<PaymentModel[]> {
  const snap = await getDocs(
    query(
      collection(firestore, "groups", groupId, "payments"),
      where("cycleNumber", "==", cycleNumber),
    ),
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      cycleNumber: Number(data.cycleNumber ?? 0),
      userId: (data.userId as string | undefined) ?? "",
      userName: (data.userName as string | undefined) ?? "",
      amount: Number(data.amount ?? 0),
      currency: (data.currency as string | undefined) ?? "CFA",
      type: (data.type as "contribution" | "payout" | undefined) ?? "contribution",
      status: (data.status as string | undefined) ?? null,
      isLate: Boolean(data.isLate ?? false),
      penaltyAmount: data.penaltyAmount as number | undefined,
      position: data.position as number | undefined,
      recordedBy: (data.recordedBy as string | undefined) ?? "",
      note: (data.note as string | undefined) ?? null,
    };
  });
}

/** Returns whether a group is eligible for a destructive cycle wipe.
 *  Two cases are allowed:
 *   * Mock groups — the whole point of the mock is that we can wipe things.
 *   * Groups that have never started (currentCycle is 0 or null) — no member
 *     money has moved yet, so there's nothing to destroy.
 *  Anything else is a live-money group with real payment history; wipe is
 *  refused and the super admin has to use the reversal flow (adds
 *  compensating entries, keeps history intact) — build lands in the next
 *  commit. */
export function isCycleWipeAllowed(
  g: Pick<{ moneyProvider: string | null; currentCycle: number | null }, "moneyProvider" | "currentCycle">,
): { allowed: boolean; reason?: string } {
  if (g.moneyProvider === "mock") return { allowed: true };
  const c = g.currentCycle ?? 0;
  if (c <= 0) return { allowed: true };
  return {
    allowed: false,
    reason:
      "This group has real payments recorded. Destructive wipe is blocked to preserve member history. Use the reversal flow instead — it appends a compensating ledger entry without deleting the original.",
  };
}

// ── Reversal flow (compensating ledger entries) ──────────────────────────
// For live-money groups the destructive wipe is refused. Instead the super
// admin picks a specific ledger entry and appends a compensating entry that
// mirrors it with a negated amount, same kind/userId/cycle/phase, and a
// `reversesEntryId` linkage. The original stays immutable so the audit
// trail is intact; money-flow rollups sum arithmetic so the negative
// amount cancels the mistake in every downstream report.

export type LedgerKind = "contribution" | "payout" | "refund" | "penalty";

export type LedgerEntryRecord = {
  id: string;
  kind: LedgerKind;
  phase: string;
  userId: string;
  amount: number;
  currency: string;
  cycleNumber: number;
  recordedBy: string;
  createdAt: Date | null;
  paymentId: string | null;
  note: string | null;
  reversesEntryId: string | null;
};

/** Loads every ledger entry for [groupId] on [cycleNumber], newest first.
 *  Used by the reversal picker so the super admin can see exactly which
 *  event they're compensating for before writing the reversal. */
export async function loadCycleLedger(
  groupId: string,
  cycleNumber: number,
): Promise<LedgerEntryRecord[]> {
  const snap = await getDocs(
    query(
      collection(firestore, "groups", groupId, "ledger"),
      where("cycleNumber", "==", cycleNumber),
    ),
  );
  const entries = snap.docs.map((d): LedgerEntryRecord => {
    const data = d.data();
    return {
      id: d.id,
      kind: (data.kind as LedgerKind | undefined) ?? "contribution",
      phase: (data.phase as string | undefined) ?? "active",
      userId: (data.userId as string | undefined) ?? "",
      amount: Number(data.amount ?? 0),
      currency: (data.currency as string | undefined) ?? "CFA",
      cycleNumber: Number(data.cycleNumber ?? 0),
      recordedBy: (data.recordedBy as string | undefined) ?? "",
      createdAt: (data.createdAt as Timestamp | undefined)?.toDate() ?? null,
      paymentId: (data.paymentId as string | undefined) ?? null,
      note: (data.note as string | undefined) ?? null,
      reversesEntryId: (data.reversesEntryId as string | undefined) ?? null,
    };
  });
  entries.sort((a, b) => {
    const ta = a.createdAt?.getTime() ?? 0;
    const tb = b.createdAt?.getTime() ?? 0;
    return tb - ta;
  });
  return entries;
}

/** Appends a compensating ledger entry that mirrors [original] with a
 *  negated amount. Optionally clears the member's `payoutCycle` when the
 *  original was a payout that shouldn't have been recorded. Never touches
 *  the original entry — the ledger rule blocks that anyway. */
export async function reverseLedgerEntry(args: {
  groupId: string;
  original: LedgerEntryRecord;
  reason: string;
  clearMemberPayoutCycle?: boolean;
  isTest: boolean;
}): Promise<{ reversalEntryId: string }> {
  const trimmedReason = args.reason.trim();
  if (!trimmedReason) throw new Error("Reason is required for a reversal.");

  const actor = firebaseAuth.currentUser;
  if (!actor) throw new Error("Not signed in.");

  const { groupId, original } = args;

  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");

  const suffix = Date.now();
  const reversalId = `reversal_${original.id}_${suffix}`;
  const reversalRef = doc(
    firestore,
    "groups",
    groupId,
    "ledger",
    reversalId,
  );

  const batch = writeBatch(firestore);
  batch.set(reversalRef, {
    kind: original.kind,
    phase: original.phase,
    userId: original.userId,
    amount: -original.amount,
    currency: original.currency,
    cycleNumber: original.cycleNumber,
    recordedBy: actor.uid,
    createdAt: serverTimestamp(),
    reversesEntryId: original.id,
    ...(original.paymentId ? { paymentId: original.paymentId } : {}),
    note: `Reversal: ${trimmedReason}`,
  });

  if (args.clearMemberPayoutCycle && original.kind === "payout") {
    const memberRef = doc(
      firestore,
      "groups",
      groupId,
      "members",
      original.userId,
    );
    batch.update(memberRef, { payoutCycle: deleteField() });
  }

  await batch.commit();

  await writeAudit({
    action: "reverse_ledger_entry",
    targetType: "cycle",
    targetId: `${groupId}:${original.cycleNumber}`,
    test: args.isTest,
    before: {
      entryId: original.id,
      kind: original.kind,
      amount: original.amount,
      userId: original.userId,
      cycleNumber: original.cycleNumber,
    },
    after: {
      reversalEntryId: reversalId,
      compensatingAmount: -original.amount,
      clearedPayoutCycle: !!args.clearMemberPayoutCycle && original.kind === "payout",
    },
    reason: trimmedReason,
    metadata: { groupId },
  });

  return { reversalEntryId: reversalId };
}

/** Wipes every payment record for the given cycle, clears payoutCycle on
 *  members who were paid that cycle, and resets the group's currentCycle
 *  back to that number. Refuses to run on live-money groups that already
 *  have payment history — that path requires reversal, not deletion. */
export async function wipeCycleData(
  groupId: string,
  cycleNumber: number,
): Promise<{ paymentsDeleted: number; membersUnpaid: number }> {
  const groupRef = doc(firestore, "groups", groupId);
  const groupBefore = await getDoc(groupRef);
  if (!groupBefore.exists()) throw new Error("Group not found.");
  const groupData = groupBefore.data() as {
    moneyProvider?: string | null;
    currentCycle?: number | null;
    name?: string;
  };
  const gate = isCycleWipeAllowed({
    moneyProvider: groupData.moneyProvider ?? null,
    currentCycle: groupData.currentCycle ?? null,
  });
  if (!gate.allowed) {
    throw new Error(
      `"${groupData.name ?? groupId}": ${gate.reason ?? "Destructive wipe blocked."}`,
    );
  }
  const isTest = groupData.moneyProvider === "mock";

  const paymentsCol = collection(firestore, "groups", groupId, "payments");
  const membersCol = collection(firestore, "groups", groupId, "members");
  const [paymentSnap, memberSnap] = await Promise.all([
    getDocs(query(paymentsCol, where("cycleNumber", "==", cycleNumber))),
    getDocs(query(membersCol, where("payoutCycle", "==", cycleNumber))),
  ]);

  const batch = writeBatch(firestore);
  for (const d of paymentSnap.docs) batch.delete(d.ref);
  for (const d of memberSnap.docs) batch.update(d.ref, { payoutCycle: deleteField() });
  batch.update(groupRef, { currentCycle: cycleNumber });
  await batch.commit();

  await writeAudit({
    action: "wipe_cycle_data",
    targetType: "cycle",
    targetId: `${groupId}:${cycleNumber}`,
    test: isTest,
    after: {
      paymentsDeleted: paymentSnap.size,
      membersUnpaid: memberSnap.size,
      currentCycleResetTo: cycleNumber,
    },
    metadata: { groupId, cycleNumber },
  });

  return {
    paymentsDeleted: paymentSnap.size,
    membersUnpaid: memberSnap.size,
  };
}
