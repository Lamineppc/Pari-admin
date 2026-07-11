// Cycle-correction service — TS port of FirestoreService.wipeCycleData in
// the mobile repo. Deletes every payment record for a specific cycle,
// clears payoutCycle on any member who was paid that cycle, and rolls
// group.currentCycle back to that number. Runs as one Firestore batch so
// partial failures roll back.

import {
  collection,
  doc,
  deleteField,
  getDocs,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "./firebase";

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

/** Wipes every payment record for the given cycle, clears payoutCycle on
 *  members who were paid that cycle, and resets the group's currentCycle
 *  back to that number. Returns counts so the confirmation toast can
 *  surface what actually changed. */
export async function wipeCycleData(
  groupId: string,
  cycleNumber: number,
): Promise<{ paymentsDeleted: number; membersUnpaid: number }> {
  const groupRef = doc(firestore, "groups", groupId);
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

  return {
    paymentsDeleted: paymentSnap.size,
    membersUnpaid: memberSnap.size,
  };
}
