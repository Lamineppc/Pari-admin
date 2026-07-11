// PaymentProvider — the abstraction between the admin panel and whichever
// source of money is behind a group. Mirrors lib/services/money/payment_provider.dart
// in the mobile repo. Two implementations are planned:
//
//   * MockPaymentProvider (see mock/ in this folder) — Firestore-backed
//     wallets. Reachable only for groups whose moneyProvider === 'mock'
//     and users flagged isTestAccount: true. Isolated by design so it
//     can be deleted in one PR. See docs/mock_money.md in the mobile repo.
//   * OrangeMoneyPaymentProvider — real Orange Money HTTP API via Cloud
//     Functions. Ships in PR 6b–d.
//
// All money-moving code from the admin panel uses this interface. Both
// implementations satisfy it, so switching providers doesn't change any
// call site.

export type PaymentProviderId = "mock" | "orange_money";
export type TransferPurpose = "contribution" | "payout" | "refund" | "penalty";

export interface TransferArgs {
  fromWalletId: string;
  toWalletId: string;
  amount: number;
  purpose: TransferPurpose;
  groupId: string;
  cycleNumber: number;
  note?: string;
}

export interface PaymentProvider {
  readonly id: PaymentProviderId;

  /**
   * Current balance of the wallet identified by walletId. Wallet IDs are
   * opaque strings; today's convention is `<uid>` for a user wallet and
   * `group:<groupId>` for a group pot.
   */
  balanceFor(walletId: string): Promise<number>;

  /**
   * Atomically move value between two wallets. Throws on insufficient
   * balance, unknown wallets, or provider-side rejection. Returns the
   * provider's transaction ID for the audit record.
   */
  transfer(args: TransferArgs): Promise<string>;
}
