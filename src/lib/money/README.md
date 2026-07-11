# Money layer (admin panel side)

Mirror of `lib/services/money/` in the mobile repo. All money-moving code
in the admin panel talks to the `PaymentProvider` interface in
`payment-provider.ts`; concrete implementations live in provider-specific
folders.

- `mock/` — Firestore-backed simulation provider. Deletable in one PR.
- `orange-money-provider.ts` (planned, PR 6b–d) — real Orange Money via
  Cloud Functions.

See `docs/mock_money.md` in the mobile repo for the isolation model and
the removal checklist.
