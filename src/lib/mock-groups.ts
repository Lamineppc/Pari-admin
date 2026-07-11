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
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { firestore } from "./firebase";
import {
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
