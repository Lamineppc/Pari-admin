import {
  addDoc,
  collection,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  doc,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { firebaseAuth, firestore } from "./firebase";

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
  });
  return true;
}

// Super-admin-only: flip a user between real and simulation-only. Firestore
// rules gate the field so no other caller succeeds. Changing the flag does
// not touch existing memberships — the membership-write rule only checks
// isTestAccount on future joins, so the two universes stay decoupled.
export async function setUserIsTestAccount(uid: string, isTestAccount: boolean): Promise<void> {
  await updateDoc(doc(firestore, "users", uid), { isTestAccount });
}

export async function setUserBan(
  uid: string,
  banType: BanType | null,
  reason: string = "",
): Promise<void> {
  const isBanning = banType !== null;
  await updateDoc(doc(firestore, "users", uid), {
    banType: banType,
    banReason: isBanning ? reason : null,
    banAt: isBanning ? serverTimestamp() : null,
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
