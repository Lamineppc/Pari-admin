import {
  addDoc,
  arrayRemove,
  collection,
  collectionGroup,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  doc,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { firebaseAuth, firebaseFunctions, firestore } from "./firebase";
import { writeAudit } from "./audit";

// Mirrors lib/models/platform_user.dart on mobile.
export type BanType = "soft" | "hard";

export type PlatformUser = {
  uid: string;
  name: string;
  email: string;
  username: string | null;
  banType: BanType | null;
  banReason: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  // Marks an account as simulation-only. Test accounts can join mock
  // groups; real accounts can't. Only the super admin can flip this
  // flag. See docs/mock_money.md in the mobile repo.
  isTestAccount: boolean;
};

function toUser(snap: QueryDocumentSnapshot): PlatformUser {
  const d = snap.data();
  return {
    uid: (d.uid as string | undefined) ?? snap.id,
    name: (d.name as string | undefined) ?? "",
    email: (d.email as string | undefined) ?? "",
    username: (d.username as string | undefined) ?? null,
    banType: (d.banType as BanType | undefined) ?? null,
    banReason: (d.banReason as string | undefined) ?? null,
    city: (d.city as string | undefined) ?? null,
    state: (d.state as string | undefined) ?? null,
    country: (d.country as string | undefined) ?? null,
    isTestAccount: (d.isTestAccount as boolean | undefined) ?? false,
  };
}

// Live stream of all users, alphabetized by name. Same shape as
// FirestoreService.allUsersStream() in the mobile repo.
export function subscribeUsers(cb: (users: PlatformUser[]) => void, onError?: (e: Error) => void) {
  const q = query(collection(firestore, "users"), orderBy("name"));
  return onSnapshot(
    q,
    (s) => cb(s.docs.map(toUser)),
    (err) => onError?.(err),
  );
}

// ── Per-user activity streams (for the /users/[uid] detail page) ──────────

export type UserGroupMembership = {
  groupId: string;
  groupName: string;
  role: "admin" | "manager" | "member";
  position: number;
  joinCycle: number;
  payoutCycle: number | null;
  kicked: boolean;
};

/// Live stream of every group [uid] belongs to. Uses the groups doc's
/// `memberIds` array (indexed for array-contains) then reads each
/// group's member subdoc for role/position. Not paginated — the
/// panel expects roster sizes in the low hundreds max.
export function subscribeUserGroups(
  uid: string,
  cb: (rows: UserGroupMembership[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collection(firestore, "groups"),
    where("memberIds", "array-contains", uid),
  );
  return onSnapshot(
    q,
    async (snap) => {
      const rows = await Promise.all(
        snap.docs.map(async (g) => {
          const memberSnap = await getDoc(doc(g.ref, "members", uid));
          const m = memberSnap.data() ?? {};
          const groupName = String(g.data().name ?? g.id);
          return {
            groupId: g.id,
            groupName,
            role: (m.role as UserGroupMembership["role"] | undefined) ?? "member",
            position: Number(m.position ?? 0),
            joinCycle: Number(m.joinCycle ?? 1),
            payoutCycle:
              typeof m.payoutCycle === "number" ? m.payoutCycle : null,
            kicked: m.kicked === true,
          };
        }),
      );
      rows.sort((a, b) => a.groupName.localeCompare(b.groupName));
      cb(rows);
    },
    (err) => onError?.(err),
  );
}

export type UserPaymentEntry = {
  id: string;
  groupId: string;
  cycleNumber: number;
  amount: number;
  currency: string;
  type: "contribution" | "payout";
  status: string | null;
  paidAt: Date | null;
  isLate: boolean;
};

/// Live stream of every payment doc where userId equals [uid], across
/// every group. Uses a collectionGroup query — requires the
/// `payments` collectionGroup index on (userId, paidAt desc), which
/// Firestore prompts to create on first run.
export function subscribeUserPayments(
  uid: string,
  cb: (rows: UserPaymentEntry[]) => void,
  onError?: (e: Error) => void,
) {
  const q = query(
    collectionGroup(firestore, "payments"),
    where("userId", "==", uid),
    orderBy("paidAt", "desc"),
  );
  return onSnapshot(
    q,
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const data = d.data();
          // parent chain: payments -> {paymentId} ; parent of payments
          // collection is the group doc.
          const groupId = d.ref.parent.parent?.id ?? "";
          return {
            id: d.id,
            groupId,
            cycleNumber: Number(data.cycleNumber ?? 0),
            amount: Number(data.amount ?? 0),
            currency: String(data.currency ?? "CFA"),
            type:
              (data.type as "contribution" | "payout" | undefined) ??
              "contribution",
            status: (data.status as string | undefined) ?? null,
            paidAt: (data.paidAt as Timestamp | undefined)?.toDate() ?? null,
            isLate: data.isLate === true,
          };
        }),
      ),
    (err) => onError?.(err),
  );
}

/// Live single-user stream. Used by the /users/[uid] detail page.
export function subscribeUser(
  uid: string,
  cb: (user: PlatformUser | null) => void,
  onError?: (e: Error) => void,
) {
  return onSnapshot(
    doc(firestore, "users", uid),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const d = snap.data();
      cb({
        uid: (d.uid as string | undefined) ?? snap.id,
        name: (d.name as string | undefined) ?? "",
        email: (d.email as string | undefined) ?? "",
        username: (d.username as string | undefined) ?? null,
        banType: (d.banType as BanType | undefined) ?? null,
        banReason: (d.banReason as string | undefined) ?? null,
        city: (d.city as string | undefined) ?? null,
        state: (d.state as string | undefined) ?? null,
        country: (d.country as string | undefined) ?? null,
        isTestAccount: (d.isTestAccount as boolean | undefined) ?? false,
      });
    },
    (err) => onError?.(err),
  );
}

// Mirrors FirestoreService.setUserBan. Pass banType=null to restore access.
// Silently writes a notification to the target user's inbox so they see why
// their access changed. Notification writes are best-effort — a rule
// mismatch there shouldn't block the ban itself.
/**
 * Recreates the current user's Firestore profile doc if it's missing.
 * The mobile app's login flow rejects sign-in when the profile doc is
 * absent (see lib/screens/auth/login_screen.dart) — usually a symptom of
 * a Firestore wipe leaving the Firebase Auth account dangling. Self-
 * healing on the admin panel keeps this from blocking access again.
 *
 * Only creates the doc; if one already exists, leaves it untouched so we
 * don't blow away a real profile with a minimal stub. Returns true if a
 * heal actually happened.
 */
export async function healMyProfileIfMissing(): Promise<boolean> {
  const me = firebaseAuth.currentUser;
  if (!me) return false;
  const ref = doc(firestore, "users", me.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return false;
  await setDoc(ref, {
    uid: me.uid,
    name: me.displayName ?? me.email?.split("@")[0] ?? "",
    email: (me.email ?? "").toLowerCase(),
    createdAt: serverTimestamp(),
  });
  return true;
}

/** Removes [uid] from every mock group they were dropped into as an observer
 *  and flips isTestAccount back to false. Handy for the super admin who
 *  wired themselves into a simulation and now wants their real-user privacy
 *  back. Returns the number of mock groups the user was leaving. */
export async function exitSimulationEnvironment(uid: string): Promise<number> {
  const mockGroupsSnap = await getDocs(
    query(collection(firestore, "groups"), where("moneyProvider", "==", "mock")),
  );
  let count = 0;
  for (const g of mockGroupsSnap.docs) {
    const memberIds = (g.data().memberIds as string[] | undefined) ?? [];
    if (!memberIds.includes(uid)) continue;
    await updateDoc(g.ref, { memberIds: arrayRemove(uid) });
    await deleteDoc(doc(firestore, "groups", g.id, "members", uid)).catch(
      () => {},
    );
    count += 1;
  }
  await updateDoc(doc(firestore, "users", uid), { isTestAccount: false });
  await writeAudit({
    action: "exit_simulation",
    targetType: "user",
    targetId: uid,
    test: true,
    before: { isTestAccount: true },
    after: { isTestAccount: false, leftGroups: count },
  });
  return count;
}

// Super-admin-only: flip a user between real and simulation-only. Firestore
// rules gate the field so no other caller succeeds. Changing the flag does
// not touch existing memberships — the membership-write rule only checks
// isTestAccount on future joins, so the two universes stay decoupled.
// Backfill `createdAt` on every user doc that's missing it. Older test
// accounts predate the field and the mobile heal only touches the
// signed-in user's own doc, so a super-admin sweep is the only way to
// stamp the rest in bulk. Returns how many docs were updated.
export async function backfillMissingCreatedAt(): Promise<number> {
  const snap = await getDocs(collection(firestore, "users"));
  const missing = snap.docs.filter((d) => {
    const data = d.data() as { createdAt?: unknown };
    return data.createdAt == null;
  });
  if (missing.length === 0) return 0;
  await Promise.all(
    missing.map((d) => updateDoc(d.ref, { createdAt: serverTimestamp() })),
  );
  await writeAudit({
    action: "backfill_created_at",
    targetType: "user",
    targetId: "*",
    test: false,
    after: { count: missing.length },
  });
  return missing.length;
}

// ── Cloud Function callables ───────────────────────────────────────────────

const forceSignOutFn = httpsCallable<{ uid: string }, { ok: boolean }>(
  firebaseFunctions,
  "forceSignOut",
);
const hardDeleteUserFn = httpsCallable<
  { uid: string; reason?: string },
  { ok: boolean }
>(firebaseFunctions, "hardDeleteUser");

/// Revokes every active refresh token for [uid] via the server-side
/// forceSignOut callable. The Admin SDK path is the only way to
/// invalidate someone else's sessions; the Firebase JS SDK on the
/// panel side can only sign the caller out. Client-side audit still
/// runs so the panel's audit log records the intent even if the
/// callable was already logged separately.
export async function forceSignOutUser(uid: string): Promise<void> {
  await forceSignOutFn({ uid });
  await writeAudit({
    action: "force_sign_out",
    targetType: "user",
    targetId: uid,
    test: false,
    after: { uid },
  });
}

/// Sends the Firebase Auth password reset email to [email]. Uses the
/// signed-in super-admin's Firebase Auth client — Firebase throttles
/// per-project on abuse, and the email lands in the target's inbox
/// with the standard reset link. No custom template unless a hosted
/// action URL is configured in the Firebase console.
export async function sendPasswordReset(
  uid: string,
  email: string,
): Promise<void> {
  if (!email) throw new Error("User has no email on file.");
  await sendPasswordResetEmail(firebaseAuth, email);
  await writeAudit({
    action: "send_password_reset",
    targetType: "user",
    targetId: uid,
    test: false,
    after: { email },
  });
}

/// Patches [uid]'s user doc with new [name] and/or [username]. Empty
/// strings are treated as "leave unchanged" — pass explicit values
/// only for fields you want to write. Rejects an empty name (Firebase
/// downstream requires a display name).
export async function updateUserProfile(
  uid: string,
  patch: { name?: string; username?: string },
): Promise<void> {
  const write: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const v = patch.name.trim();
    if (!v) throw new Error("Name cannot be empty.");
    write.name = v;
  }
  if (patch.username !== undefined) {
    const v = patch.username.trim().toLowerCase();
    if (v) write.username = v;
    else write.username = null;
  }
  if (Object.keys(write).length === 0) return;
  const before = await getDoc(doc(firestore, "users", uid));
  const beforeData = before.data() ?? {};
  await updateDoc(doc(firestore, "users", uid), write);
  await writeAudit({
    action: "update_user_profile",
    targetType: "user",
    targetId: uid,
    test: false,
    before: { name: beforeData.name ?? null, username: beforeData.username ?? null },
    after: write,
  });
}

/// Notify a single user via their private inbox. Same shape as
/// broadcastToGroupMembers but scoped to one uid. Type defaults to
/// "admin_notice" so mobile can route it distinctly from group
/// broadcasts.
export async function notifyUser(args: {
  uid: string;
  title: string;
  body: string;
  type?: string;
}): Promise<void> {
  const title = args.title.trim();
  const body = args.body.trim();
  if (!title) throw new Error("Title required.");
  if (!body) throw new Error("Body required.");
  await addDoc(collection(firestore, "users", args.uid, "notifications"), {
    type: args.type ?? "admin_notice",
    title,
    body,
    isRead: false,
    createdAt: serverTimestamp(),
  });
  await writeAudit({
    action: "notify_user",
    targetType: "user",
    targetId: args.uid,
    test: false,
    after: { title, body },
  });
}

/// Hard-deletes [uid]: revoke tokens, delete Firestore user doc +
/// private/contact, then delete the Firebase Auth account. Server-side
/// enforces the order and rejects self-delete. Optional [reason] is
/// stored in the server-side audit entry.
export async function hardDeleteUser(uid: string, reason?: string): Promise<void> {
  await hardDeleteUserFn({ uid, reason });
  await writeAudit({
    action: "hard_delete_user",
    targetType: "user",
    targetId: uid,
    test: false,
    reason,
    after: { uid },
  });
}

export async function setUserIsTestAccount(uid: string, isTestAccount: boolean): Promise<void> {
  await updateDoc(doc(firestore, "users", uid), { isTestAccount });
  await writeAudit({
    action: "set_test_account",
    targetType: "user",
    targetId: uid,
    test: isTestAccount, // flipping TO test = test action; flipping FROM = still test-flow
    before: { isTestAccount: !isTestAccount },
    after: { isTestAccount },
  });
}

export async function setUserBan(
  uid: string,
  banType: BanType | null,
  reason: string = "",
): Promise<void> {
  const isBanning = banType !== null;
  const before = await getDoc(doc(firestore, "users", uid));
  const beforeData = before.exists()
    ? (before.data() as { banType?: string; isTestAccount?: boolean })
    : {};
  await updateDoc(doc(firestore, "users", uid), {
    banType: banType,
    banReason: isBanning ? reason : null,
    banAt: isBanning ? serverTimestamp() : null,
  });
  await writeAudit({
    action:
      banType === "hard"
        ? "ban_user_hard"
        : banType === "soft"
          ? "ban_user_soft"
          : "restore_user",
    targetType: "user",
    targetId: uid,
    test: Boolean(beforeData.isTestAccount ?? false) || uid.startsWith("sim_"),
    before: { banType: beforeData.banType ?? null },
    after: { banType, banReason: isBanning ? reason : null },
    reason: reason || null,
  });

  // No self-notifications (mirrors _sendNotification's early return).
  const currentUid = firebaseAuth.currentUser?.uid;
  if (currentUid === uid) return;

  try {
    await addDoc(collection(firestore, "users", uid, "notifications"), {
      type: isBanning ? "account_access_revoked" : "account_access_restored",
      title: isBanning
        ? banType === "hard"
          ? "Account access revoked"
          : "Account access limited"
        : "Account access restored",
      body: isBanning
        ? reason
          ? `Your platform access has been ${banType === "hard" ? "revoked" : "limited"}: ${reason}`
          : `Your platform access has been ${banType === "hard" ? "revoked" : "limited"}.`
        : "Your platform access has been restored.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
  } catch {
    // notification failure isn't worth surfacing
  }
}
