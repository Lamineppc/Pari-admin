// Super-admin helper for seeding an entire simulation environment in one
// call: N synthetic test accounts, a Secured group tied to them, positions
// pre-locked so the Secured simulator can start immediately, and every
// wallet topped up with enough balance to complete the rotation without
// mid-run top-ups.
//
// All writes go through the super admin's session and target the mock
// universe only — moneyProvider: 'mock' on the group, isTestAccount: true
// on every synthetic user. See docs/mock_money.md in the mobile repo for
// the isolation rules.

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "./firebase";
import {
  groupPotId,
  mockPaymentProvider,
  userWalletId,
} from "./money/mock/mock-payment-provider";

export type CreateMockGroupInput = {
  name: string;
  memberCount: number;
  amount: number;
  currency?: string;
  /** How much CFA to seed on every member's wallet. Defaults to
   *  `amount × memberCount + amount` (enough to cover the full Secured
   *  rotation plus one late-payment penalty buffer). */
  startingBalance?: number;
};

export type CreateMockGroupResult = {
  groupId: string;
  memberUids: string[];
  startingBalance: number;
};

const INVITE_PREFIX = "SIM";

function randomInviteCode(): string {
  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  return `${INVITE_PREFIX}${suffix}`;
}

export async function createMockGroup(
  input: CreateMockGroupInput,
): Promise<CreateMockGroupResult> {
  const name = input.name.trim();
  const memberCount = Math.floor(input.memberCount);
  const amount = Number(input.amount);
  const currency = (input.currency ?? "CFA").trim().toUpperCase();
  const startingBalance = Number(
    input.startingBalance ?? amount * memberCount + amount,
  );

  if (name.length === 0) throw new Error("Give the group a name.");
  if (memberCount < 2 || memberCount > 20) {
    throw new Error("Member count must be between 2 and 20.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Contribution amount must be positive.");
  }
  if (!Number.isFinite(startingBalance) || startingBalance < 0) {
    throw new Error("Starting balance must be zero or positive.");
  }

  const timestamp = Date.now();
  const memberUids = Array.from(
    { length: memberCount },
    (_, i) => `sim_${timestamp}_m${i + 1}`,
  );
  const memberNames = memberUids.map((_, i) => `Test Member ${i + 1}`);
  const groupRef = doc(collection(firestore, "groups"));

  const batch = writeBatch(firestore);

  // Synthetic user docs — these accounts exist as Firestore data only, no
  // Firebase Auth backing. isTestAccount: true keeps them out of every
  // real-money code path via the membership rule.
  for (let i = 0; i < memberCount; i++) {
    batch.set(doc(firestore, "users", memberUids[i]), {
      uid: memberUids[i],
      name: memberNames[i],
      email: `${memberUids[i]}@sim.pari`,
      isTestAccount: true,
      createdAt: serverTimestamp(),
    });
  }

  // The group itself. createdBy is the first synthetic member (position 1)
  // so the mobile app's admin checks work naturally when someone opens the
  // group as that account. positionsLocked pre-flipped so the Secured
  // simulator can run immediately without a lock step.
  batch.set(groupRef, {
    type: "secured",
    name,
    description: "Simulation group",
    amount,
    currency,
    frequency: "Monthly",
    createdBy: memberUids[0],
    inviteCode: randomInviteCode(),
    status: "active",
    createdAt: serverTimestamp(),
    memberCount,
    memberIds: memberUids,
    currentCycle: 0,
    positionsLocked: true,
    penaltyType: "none",
    moneyProvider: "mock",
  });

  // Member docs. First member is admin, second is manager (Secured groups
  // require one designated manager before starting the rotation — pre-set
  // it so the simulator doesn't hit the manager-required guard).
  for (let i = 0; i < memberCount; i++) {
    const role = i === 0 ? "admin" : i === 1 ? "manager" : "member";
    batch.set(doc(firestore, "groups", groupRef.id, "members", memberUids[i]), {
      userId: memberUids[i],
      name: memberNames[i],
      email: `${memberUids[i]}@sim.pari`,
      role,
      position: i + 1,
      joinedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  // Wallet top-ups. Sequential rather than parallel so a partial failure
  // is easier to debug — the mock provider's runTransaction already
  // handles concurrency, but seeding order is fine to serialize.
  for (const uid of memberUids) {
    if (startingBalance > 0) {
      await mockPaymentProvider.topUp({
        walletId: userWalletId(uid),
        amount: startingBalance,
        currency,
      });
    }
  }

  // Group pot doc is created lazily on the first contribution transfer.
  // subscribeWallet already emits { balance: 0 } when the doc is missing,
  // so the pot-balance card renders "0" immediately without a seed.

  return {
    groupId: groupRef.id,
    memberUids,
    startingBalance,
  };
}

/** Tops up every non-observer, non-kicked member's mock wallet by
 *  [amountPerMember]. Handy when a partial-failure state drained wallets
 *  or when createMockGroup's seeding step misfired. Skips observers so a
 *  real user acting as observer doesn't get simulation balance dropped
 *  into their wallet. Returns the number of wallets touched. */
export async function refillMemberWallets(
  groupId: string,
  amountPerMember: number,
): Promise<number> {
  if (!Number.isFinite(amountPerMember) || amountPerMember <= 0) {
    throw new Error("Amount per member must be positive.");
  }
  const groupSnap = await getDoc(doc(firestore, "groups", groupId));
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.moneyProvider !== "mock") {
    throw new Error("Only mock groups can be refilled from this action.");
  }

  const membersSnap = await getDocs(
    collection(firestore, "groups", groupId, "members"),
  );
  const targets = membersSnap.docs
    .map((d) => {
      const data = d.data();
      return {
        id: d.id,
        observer: Boolean(data.observer ?? false),
        kicked: Boolean(data.kicked ?? false),
      };
    })
    .filter((m) => !m.observer && !m.kicked);

  for (const m of targets) {
    await mockPaymentProvider.topUp({
      walletId: userWalletId(m.id),
      amount: amountPerMember,
      currency: (g.currency as string | undefined) ?? "CFA",
    });
  }
  return targets.length;
}

/** Trashes every mock group on the platform in one go. Returns the number
 *  deleted. Used to hit a clean slate when a series of tests has left the
 *  Firestore data messy. Non-mock groups are never touched. */
export async function trashAllMockGroups(): Promise<number> {
  const snap = await getDocs(
    query(collection(firestore, "groups"), where("moneyProvider", "==", "mock")),
  );
  for (const d of snap.docs) {
    await trashMockGroup(d.id);
  }
  return snap.docs.length;
}

/** Deletes a mock group and every artifact it created: member docs,
 *  payments, ledger entries, all mockWallets involved, and the synthetic
 *  test-account user docs. Non-mock groups are refused so we can never
 *  accidentally hose a real group through this path. */
export async function trashMockGroup(groupId: string): Promise<void> {
  const groupRef = doc(firestore, "groups", groupId);
  const groupSnap = await getDoc(groupRef);
  if (!groupSnap.exists()) throw new Error("Group not found.");
  const g = groupSnap.data();
  if (g.moneyProvider !== "mock") {
    throw new Error("This action only works on mock groups.");
  }

  const memberIds = ((g.memberIds as string[] | undefined) ?? []).filter(
    (id) => typeof id === "string",
  );
  const syntheticUids = memberIds.filter((uid) => uid.startsWith("sim_"));

  // Wallets first — best-effort so a stubborn doc doesn't block cleanup.
  await Promise.all([
    deleteDoc(doc(firestore, "mockWallets", groupPotId(groupId))).catch(
      () => {},
    ),
    ...memberIds.map((uid) =>
      deleteDoc(doc(firestore, "mockWallets", userWalletId(uid))).catch(
        () => {},
      ),
    ),
  ]);

  // Synthetic user docs — only sim_* uids, so real observers aren't nuked.
  await Promise.all(
    syntheticUids.map((uid) =>
      deleteDoc(doc(firestore, "users", uid)).catch(() => {}),
    ),
  );

  // Subcollections in one batch. Firestore batches accept up to 500 writes.
  const [membersSnap, paymentsSnap, ledgerSnap] = await Promise.all([
    getDocs(collection(firestore, "groups", groupId, "members")),
    getDocs(collection(firestore, "groups", groupId, "payments")),
    getDocs(collection(firestore, "groups", groupId, "ledger")),
  ]);
  const batch = writeBatch(firestore);
  membersSnap.docs.forEach((d) => batch.delete(d.ref));
  paymentsSnap.docs.forEach((d) => batch.delete(d.ref));
  ledgerSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(groupRef);
  await batch.commit();
}
