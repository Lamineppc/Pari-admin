import {
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "../../firebase";
import type {
  PaymentProvider,
  TransferArgs,
} from "../payment-provider";

// TypeScript mirror of lib/services/money/mock/mock_payment_provider.dart.
// Runs the same Firestore transaction shape so mock groups behave identically
// whether they're driven from the mobile app or the admin panel.

const COLLECTION = "mockWallets";

export type Wallet = {
  id: string;
  balance: number;
  currency: string;
  updatedAt: Date | null;
};

// Deterministic wallet-ID conventions. Matches Wallet.userWalletId /
// Wallet.groupPotId in the Dart repo.
export function userWalletId(uid: string): string {
  return `user:${uid}`;
}

export function groupPotId(groupId: string): string {
  return `group:${groupId}`;
}

class MockPaymentProviderImpl implements PaymentProvider {
  readonly id = "mock" as const;

  async balanceFor(walletId: string): Promise<number> {
    const ref = doc(firestore, COLLECTION, walletId);
    let out = 0;
    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(ref);
      out = Number(snap.data()?.balance ?? 0);
    });
    return out;
  }

  async transfer(args: TransferArgs): Promise<string> {
    const {
      fromWalletId,
      toWalletId,
      amount,
      purpose,
      groupId,
      cycleNumber,
    } = args;
    if (amount <= 0) throw new Error(`Transfer amount must be positive (got ${amount}).`);
    if (fromWalletId === toWalletId) throw new Error("Cannot transfer to the same wallet.");
    const fromRef = doc(firestore, COLLECTION, fromWalletId);
    const toRef = doc(firestore, COLLECTION, toWalletId);
    let txId = "";
    await runTransaction(firestore, async (tx) => {
      const fromSnap = await tx.get(fromRef);
      const toSnap = await tx.get(toRef);
      const fromBalance = Number(fromSnap.data()?.balance ?? 0);
      const toBalance = Number(toSnap.data()?.balance ?? 0);
      if (fromBalance < amount) {
        throw new Error(
          `Insufficient mock balance in ${fromWalletId}: has ${fromBalance}, needs ${amount}.`,
        );
      }
      const currency =
        (fromSnap.data()?.currency as string | undefined) ??
        (toSnap.data()?.currency as string | undefined) ??
        "CFA";
      tx.set(fromRef, {
        balance: fromBalance - amount,
        currency,
        updatedAt: serverTimestamp(),
      });
      tx.set(toRef, {
        balance: toBalance + amount,
        currency: (toSnap.data()?.currency as string | undefined) ?? currency,
        updatedAt: serverTimestamp(),
      });
      const callerUid = firebaseAuth.currentUser?.uid ?? "anonymous";
      const short = groupId.slice(0, 6);
      txId = `mocktx_${Date.now()}_${callerUid}_${purpose}_g${short}c${cycleNumber}`;
    });
    return txId;
  }

  /** Seeds mock balance onto a wallet. Super-admin tooling only. */
  async topUp(args: {
    walletId: string;
    amount: number;
    currency?: string;
  }): Promise<void> {
    const { walletId, amount, currency = "CFA" } = args;
    if (amount <= 0) throw new Error(`Top-up amount must be positive (got ${amount}).`);
    const ref = doc(firestore, COLLECTION, walletId);
    await runTransaction(firestore, async (tx) => {
      const snap = await tx.get(ref);
      const current = Number(snap.data()?.balance ?? 0);
      tx.set(ref, {
        balance: current + amount,
        currency: (snap.data()?.currency as string | undefined) ?? currency,
        updatedAt: serverTimestamp(),
      });
    });
  }

  /** Live stream of a wallet's balance. Emits { balance: 0 } when the
   *  doc doesn't exist yet. */
  subscribeWallet(walletId: string, cb: (w: Wallet) => void, onError?: (e: Error) => void) {
    const ref = doc(firestore, COLLECTION, walletId);
    return onSnapshot(
      ref,
      (snap) => {
        const d = snap.data();
        cb({
          id: walletId,
          balance: Number(d?.balance ?? 0),
          currency: (d?.currency as string | undefined) ?? "CFA",
          updatedAt: (d?.updatedAt as Timestamp | undefined)?.toDate() ?? null,
        });
      },
      (err) => onError?.(err),
    );
  }
}

export const mockPaymentProvider = new MockPaymentProviderImpl();
