// Admin audit log — every consequential super-admin action gets one
// append-only entry here so we (and regulators) can reconstruct exactly
// who did what, when, and against what data. Two flags separate test-mode
// noise from real operations:
//
//   * `test: true` when the target is a mock group (moneyProvider === 'mock'),
//     a test account (isTestAccount === true), or a synthetic uid (sim_*).
//     Callers set this explicitly since they already know the shape of the
//     target from having just fetched it.
//
//   * `phase: 'prelaunch' | 'live'` — comes from NEXT_PUBLIC_PARI_PHASE at
//     write time. Flipping the env var to 'live' on launch day gives a
//     clean cut-over: regulator export filters on phase === 'live'.
//
// Firestore rule blocks updates and deletes for everyone including the
// super admin, so the log is tamper-evident.

import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

export type AuditAction =
  | "kick_defaulted_admin"
  | "demote_defaulted_admin"
  | "promote_manager_to_admin"
  | "take_over_as_caretaker"
  | "dismiss_escalation"
  | "flag_escalation_manual"
  | "flag_escalation_auto"
  | "wipe_cycle_data"
  | "reverse_ledger_entry"
  | "set_group_status"
  | "trash_mock_group"
  | "trash_all_mock_groups"
  | "create_mock_group"
  | "add_me_as_observer"
  | "refill_member_wallets"
  | "top_up_wallet"
  | "ban_user_soft"
  | "ban_user_hard"
  | "restore_user"
  | "set_test_account"
  | "exit_simulation"
  | "approve_store"
  | "reject_store"
  | "revoke_store"
  | "suspend_store"
  | "reinstate_store"
  | "backfill_created_at"
  | "set_member_role"
  | "swap_member_positions"
  | "kick_member"
  | "reset_member_payout"
  | "super_admin_record_contribution"
  | "super_admin_record_payout"
  | "set_group_current_cycle"
  | "set_positions_locked"
  | "resync_member_positions"
  | "heal_missing_slots";

export type AuditTargetType =
  | "group"
  | "user"
  | "store"
  | "wallet"
  | "cycle"
  | "platform";

export type AuditPhase = "prelaunch" | "live";

export type AuditEntry = {
  id: string;
  action: AuditAction;
  actorUid: string;
  actorEmail: string;
  targetType: AuditTargetType;
  targetId: string;
  test: boolean;
  phase: AuditPhase;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date | null;
};

const COLLECTION = "admin_audit_log";

function currentPhase(): AuditPhase {
  return (
    (process.env.NEXT_PUBLIC_PARI_PHASE as AuditPhase | undefined) ??
    "prelaunch"
  );
}

/**
 * Master switch for audit writes. Off during the current messy testing
 * phase so the log doesn't accumulate noise. Flip
 * `NEXT_PUBLIC_AUDIT_LOG_ENABLED=true` on Vercel and redeploy when the
 * platform is at "prelaunch test with real transactions in the pipeline"
 * — that gives a clean starting point for the tamper-evident chain.
 * Reads always work; only writes are gated.
 */
export function isAuditLoggingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUDIT_LOG_ENABLED === "true";
}

/**
 * Records one action against the audit log. Best-effort: a failure here
 * never blocks the caller's actual operation — the audit is a follow-up
 * to a write that already committed, and swallowing errors keeps the
 * failure surface local. Failures still hit console.error so a broken
 * audit rule is loud during development.
 */
export async function writeAudit(args: {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  test: boolean;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isAuditLoggingEnabled()) return; // master switch off — silent no-op
  const actor = firebaseAuth.currentUser;
  if (!actor) return; // no super admin session, nothing to record
  try {
    await addDoc(collection(firestore, COLLECTION), {
      action: args.action,
      actorUid: actor.uid,
      actorEmail: actor.email ?? "",
      targetType: args.targetType,
      targetId: args.targetId,
      test: args.test,
      phase: currentPhase(),
      before: args.before ?? null,
      after: args.after ?? null,
      reason: args.reason ?? null,
      metadata: args.metadata ?? null,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    // Do not throw — the operation already succeeded; a broken audit
    // shouldn't undo that. But log loudly so the developer notices.
    console.error("[audit] failed to record entry", args.action, err);
  }
}

function toEntry(snap: QueryDocumentSnapshot): AuditEntry {
  const d = snap.data();
  return {
    id: snap.id,
    action: (d.action as AuditAction | undefined) ?? "set_group_status",
    actorUid: (d.actorUid as string | undefined) ?? "",
    actorEmail: (d.actorEmail as string | undefined) ?? "",
    targetType: (d.targetType as AuditTargetType | undefined) ?? "platform",
    targetId: (d.targetId as string | undefined) ?? "",
    test: Boolean(d.test ?? false),
    phase: (d.phase as AuditPhase | undefined) ?? "prelaunch",
    before: (d.before as Record<string, unknown> | undefined) ?? null,
    after: (d.after as Record<string, unknown> | undefined) ?? null,
    reason: (d.reason as string | undefined) ?? null,
    metadata: (d.metadata as Record<string, unknown> | undefined) ?? null,
    createdAt: (d.createdAt as Timestamp | undefined)?.toDate() ?? null,
  };
}

/**
 * Live-updating stream of the most recent audit entries. Bounded by `max`
 * so the initial payload stays small even when the log has grown; the
 * dedicated /audit-log page paginates for the older history.
 */
export function subscribeAuditLog(
  cb: (entries: AuditEntry[]) => void,
  options: {
    max?: number;
    hideTest?: boolean;
    hidePrelaunch?: boolean;
    action?: AuditAction;
  } = {},
  onError?: (e: Error) => void,
) {
  const filters: ReturnType<typeof where>[] = [];
  if (options.hideTest) filters.push(where("test", "==", false));
  if (options.hidePrelaunch) filters.push(where("phase", "==", "live"));
  if (options.action) filters.push(where("action", "==", options.action));

  const q = query(
    collection(firestore, COLLECTION),
    ...filters,
    orderBy("createdAt", "desc"),
    limit(options.max ?? 200),
  );
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toEntry)),
    (err) => onError?.(err),
  );
}
