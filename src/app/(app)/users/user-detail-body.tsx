"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Beaker,
  Bell,
  ChevronRight,
  Copy,
  KeyRound,
  LogOut,
  Mail,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { subscribeAuditLog, writeAudit, type AuditEntry } from "@/lib/audit";
import {
  mockPaymentProvider,
  userWalletId,
  type Wallet,
} from "@/lib/money/mock/mock-payment-provider";
import {
  exitSimulationEnvironment,
  forceSignOutUser,
  generatePasswordResetLink,
  hardDeleteUser,
  notifyUser,
  sendPasswordReset,
  sendSupportMessage,
  setContactValue,
  setContactVerified,
  setUserEscalation,
  setUserBan,
  setUserIsTestAccount,
  subscribeSupportMessages,
  subscribeUserAdminNotes,
  subscribeUserContact,
  fetchUserGroups,
  subscribeUserPayments,
  updateUserAdminNotes,
  updateUserEmail,
  updateUserProfile,
  type BanType,
  type PlatformUser,
  type SupportMessage,
  type UserContact,
  type UserEscalationFlag,
  type UserGroupMembership,
  type UserPaymentEntry,
} from "@/lib/users";
import {
  dismissUserEscalationArchive,
  subscribeArchiveForTarget,
  type EscalationArchiveEntry,
} from "@/lib/escalation-archive";
import { ArchiveList } from "@/components/escalation-archive-list";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createGroupForUser } from "@/lib/groups";
import { createStoreForUser, fetchUserIndividualPosting, fetchUserStores, type Store, type StoreListing } from "@/lib/stores";
import { setUserCourierRole } from "@/lib/orders";
import { CountrySelect } from "@/components/country-select";
import { findCountry } from "@/lib/countries";

/// Full-page super-admin controls for a single user. Rendered by
/// /users/[uid]/page.tsx; not a modal — mirrors how the groups detail
/// page owns its own route so the URL is shareable and the surface
/// can grow past what a slide-out sheet would fit.
///
/// `onDeleted` fires after a successful hard-delete so the caller can
/// navigate away (the user doc is gone).
export function UserDetailBody({
  user,
  currentUid,
  onDeleted,
}: {
  user: PlatformUser;
  currentUid: string | null;
  onDeleted?: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<
    | BanType
    | "restore"
    | "topup"
    | "toggle-test"
    | "toggle-courier"
    | "exit-sim"
    | "force-signout"
    | "hard-delete"
    | "reset-pw"
    | null
  >(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("50000");
  const [groups, setGroups] = useState<UserGroupMembership[] | null>(null);
  const [payments, setPayments] = useState<UserPaymentEntry[] | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [storesReloadKey, setStoresReloadKey] = useState(0);
  const [individualPosting, setIndividualPosting] = useState<StoreListing | null | undefined>(undefined);
  const [contact, setContact] = useState<UserContact | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [escalationArchive, setEscalationArchive] = useState<
    EscalationArchiveEntry[] | null
  >(null);

  useEffect(() => {
    const unsub = subscribeArchiveForTarget(
      "user",
      user.uid,
      setEscalationArchive,
      () => setEscalationArchive([]),
    );
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    const unsub = subscribeAuditLog(
      (entries) => setAudit(entries),
      { targetId: user.uid, max: 40 },
      () => setAudit([]),
    );
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    const unsub = subscribeUserContact(
      user.uid,
      (c) => setContact(c),
      () => setContact({ phone: null, phoneVerified: false, whatsapp: null, whatsappVerified: false }),
    );
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    let cancelled = false;
    fetchUserGroups(user.uid)
      .then((rows) => {
        if (!cancelled) setGroups(rows);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  useEffect(() => {
    let cancelled = false;
    fetchUserStores(user.uid)
      .then((rows) => {
        if (!cancelled) setStores(rows);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid, storesReloadKey]);

  useEffect(() => {
    let cancelled = false;
    fetchUserIndividualPosting(user.uid)
      .then((p) => {
        if (!cancelled) setIndividualPosting(p);
      })
      .catch(() => {
        if (!cancelled) setIndividualPosting(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  useEffect(() => {
    const unsub = subscribeUserPayments(user.uid, setPayments, () =>
      setPayments([]),
    );
    return unsub;
  }, [user.uid]);

  useEffect(() => {
    setReason("");
    setTopUpAmount("50000");
  }, [user.uid]);

  useEffect(() => {
    if (!user.isTestAccount) {
      setWallet(null);
      return;
    }
    const unsub = mockPaymentProvider.subscribeWallet(
      userWalletId(user.uid),
      setWallet,
    );
    return unsub;
  }, [user.uid, user.isTestAccount]);

  const isSelf = user.uid === currentUid;
  const isBanned = user.banType !== null;
  const location = [user.city, user.state, user.country]
    .filter(Boolean)
    .join(", ");

  async function apply(kind: BanType | "restore") {
    setBusy(kind);
    try {
      const nextBan: BanType | null = kind === "restore" ? null : kind;
      await setUserBan(user.uid, nextBan, reason);
      toast.success(
        kind === "restore"
          ? "Access restored."
          : kind === "soft"
            ? "Access limited."
            : "Access revoked.",
      );
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyExitSimulation() {
    if (
      !window.confirm(
        `Remove ${user.name || user.email} from every mock group and flip isTestAccount back to false?`,
      )
    )
      return;
    setBusy("exit-sim");
    try {
      const n = await exitSimulationEnvironment(user.uid);
      toast.success(
        n > 0
          ? `Removed from ${n} mock group(s) and reset to a real account.`
          : "Reset to a real account. No mock-group memberships found.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyForceSignOut() {
    if (
      !window.confirm(
        `Revoke every active session for ${user.name || user.email}? The next backend call from their app will fail auth and force them to sign in again.`,
      )
    )
      return;
    setBusy("force-signout");
    try {
      await forceSignOutUser(user.uid);
      toast.success("All sessions revoked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyHardDelete() {
    if (
      !window.confirm(
        `HARD-DELETE ${user.name || user.email} (${user.uid})?\n\nRemoves the Firestore user doc, private/contact subdoc, and Firebase Auth account. Group memberships and past payments stay as historical references. This cannot be undone.`,
      )
    )
      return;
    const r = window.prompt(
      "Reason for hard-delete (recorded in the audit trail):",
      "",
    );
    if (r === null) return;
    setBusy("hard-delete");
    try {
      await hardDeleteUser(user.uid, r.trim() || undefined);
      toast.success("User hard-deleted.");
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyCopyResetLink() {
    setBusy("reset-pw");
    try {
      const { link, email } = await generatePasswordResetLink(user.uid);
      await navigator.clipboard.writeText(link);
      toast.success(`Reset link for ${email} copied to clipboard.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyResetPassword() {
    if (!user.email) {
      toast.error("User has no email on file.");
      return;
    }
    if (
      !window.confirm(
        `Send a Firebase Auth password reset email to ${user.email}?`,
      )
    )
      return;
    setBusy("reset-pw");
    try {
      await sendPasswordReset(user.uid, user.email);
      toast.success(`Reset email sent to ${user.email}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyToggleCourier() {
    const nextValue = !user.roles.includes("courier");
    setBusy("toggle-courier");
    try {
      await setUserCourierRole(user.uid, nextValue);
      toast.success(
        nextValue
          ? "Courier role granted."
          : "Courier role revoked.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyToggleTest() {
    const nextValue = !user.isTestAccount;
    setBusy("toggle-test");
    try {
      await setUserIsTestAccount(user.uid, nextValue);
      toast.success(
        nextValue
          ? "Converted to test account. Can now join mock groups only."
          : "Converted back to a real account. Can join real groups only.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function applyTopUp() {
    const amount = Number(topUpAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a positive amount.");
      return;
    }
    setBusy("topup");
    try {
      await mockPaymentProvider.topUp({
        walletId: userWalletId(user.uid),
        amount,
      });
      await writeAudit({
        action: "top_up_wallet",
        targetType: "wallet",
        targetId: userWalletId(user.uid),
        test: true,
        after: { amount, currency: "CFA" },
        metadata: { userUid: user.uid },
      });
      toast.success(`Topped up ${amount.toLocaleString()} CFA.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.name || "(no name)"}
          </h1>
          {isBanned && (
            <Badge
              variant="outline"
              className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {user.banType === "hard" ? "Hard ban" : "Soft ban"}
            </Badge>
          )}
          {user.isTestAccount && (
            <Badge
              variant="outline"
              className="border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200"
            >
              <Beaker className="mr-1 h-3 w-3" />
              Test account
            </Badge>
          )}
          {user.escalationFlag && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
              title={user.escalationReason ?? undefined}
            >
              ⚠ {user.escalationFlag.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{user.email}</p>
        {user.escalationFlag && (
          <div className="relative mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 pr-10 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <button
              type="button"
              title="Dismiss and archive this complaint"
              onClick={async () => {
                const note = window.prompt(
                  "Optional note about why this is being dismissed (leave blank if none):",
                  "",
                );
                if (note === null) return;
                try {
                  await dismissUserEscalationArchive(user.uid, note);
                  toast.success("Complaint dismissed and archived.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Dismiss failed.");
                }
              }}
              className="absolute top-2 right-2 rounded-md p-1 hover:bg-amber-100 dark:hover:bg-amber-900"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-1 font-medium">
              Escalation: {user.escalationFlag.replace(/_/g, " ")}
              {user.escalationFlaggedAt && (
                <span className="ml-2 text-xs opacity-70">
                  · {user.escalationFlaggedAt.toLocaleString()}
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap">
              {user.escalationReason?.trim() || "No reason recorded."}
            </div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-3 rounded-md border p-4 sm:grid-cols-3">
        <Field label="Username" value={user.username ?? "—"} />
        <Field label="Location" value={location || "—"} />
        <Field label="uid" value={user.uid} mono />
        <Field label="Member since" value={fmtDate(user.createdAt)} />
        <Field label="Last active" value={fmtRelative(user.lastActiveAt)} />
      </div>

      {!isSelf && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setProfileOpen(true)}
          >
            <Pencil /> Edit name / username <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setEmailOpen(true)}
          >
            <Mail /> Change email <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setNotifyOpen(true)}
          >
            <Bell /> Notify user <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={busy !== null}
            onClick={applyResetPassword}
          >
            <KeyRound /> Send password reset email <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={busy !== null}
            onClick={applyCopyResetLink}
          >
            <Copy /> Copy reset link <ChevronRight />
          </Button>
        </div>
      )}

      {isBanned && user.banReason && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
          <div className="font-medium text-red-800 dark:text-red-200">
            Current reason
          </div>
          <div className="mt-1 text-red-700 dark:text-red-300">
            {user.banReason}
          </div>
        </div>
      )}

      <Separator />

      <section className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Access control
        </div>

        {isSelf && (
          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            You can&apos;t change access on your own super-admin account from here.
          </p>
        )}

        {!isSelf && !isBanned && (
          <>
            <div className="grid max-w-md gap-2">
              <Label htmlFor="reason">Reason (sent to the user)</Label>
              <Textarea
                id="reason"
                placeholder="Explain briefly. Left blank sends a generic message."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => apply("soft")}
              className="w-fit"
            >
              <ShieldAlert /> Limit access (soft ban) <ChevronRight />
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => apply("hard")}
              className="w-fit"
            >
              <ShieldOff /> Revoke access (hard ban) <ChevronRight />
            </Button>
          </>
        )}

        {!isSelf && isBanned && (
          <Button
            variant="default"
            disabled={busy !== null}
            onClick={() => apply("restore")}
            className="w-fit"
          >
            <ShieldCheck /> Restore access <ChevronRight />
          </Button>
        )}
      </section>

      {!isSelf && (
        <>
          <Separator />
          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Session
            </div>
            <p className="text-xs text-muted-foreground">
              Force sign-out revokes every active refresh token and stamps a
              signal on the user doc so the mobile app signs them out within
              seconds instead of waiting for the cached ID token to expire.
            </p>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={applyForceSignOut}
              className="w-fit"
            >
              <LogOut /> Force sign-out <ChevronRight />
            </Button>
          </section>
          <Separator />
          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Danger zone
            </div>
            <p className="text-xs text-muted-foreground">
              Hard-delete removes the Firestore user doc, the private contact
              subdoc, and the Firebase Auth account. Historical references
              (group memberships, payments) stay put so audit trails are
              preserved.
            </p>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={applyHardDelete}
              className="w-fit"
            >
              <Trash2 /> Hard-delete account <ChevronRight />
            </Button>
          </section>
          <Separator />
          <section className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Simulation
            </div>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                {user.isTestAccount
                  ? "This account is a test account and can only join mock groups. Converting it back means it can join real groups but loses access to simulation-only groups."
                  : "This account is a real user. Converting to a test account lets it join mock simulation groups, and blocks it from joining real groups going forward. Existing memberships in either universe are preserved."}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={applyToggleTest}
              className="w-fit"
            >
              <Beaker />{" "}
              {user.isTestAccount
                ? "Convert to real account"
                : "Convert to test account"}{" "}
              <ChevronRight />
            </Button>
            {user.isTestAccount && (
              <>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={applyExitSimulation}
                  className="w-fit"
                >
                  <LogOut /> Exit simulation environment <ChevronRight />
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Removes this uid from every mock group&apos;s memberIds +
                  member docs and flips isTestAccount back to false in one go.
                </p>
              </>
            )}
            <Separator className="my-2" />
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Roles
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={user.roles.includes("courier") ? "default" : "outline"}
                disabled={busy !== null}
                onClick={applyToggleCourier}
                className="w-fit"
              >
                {user.roles.includes("courier")
                  ? "Revoke courier role"
                  : "Grant courier role"}{" "}
                <ChevronRight />
              </Button>
              <p className="text-[11px] text-muted-foreground">
                Couriers appear in the &quot;Assign courier&quot; picker on order
                detail pages.
              </p>
            </div>
          </section>
        </>
      )}

      {!isSelf && (
        <>
          <Separator />
          <UserEscalationPanel user={user} />

          <Separator />
          <EscalationArchivePanel entries={escalationArchive} />

          <Separator />
          <UserNotesPanel uid={user.uid} />
        </>
      )}

      <Separator />
      <UserContactPanel uid={user.uid} contact={contact} />

      <Separator />
      <UserGroupsPanel groups={groups} user={user} />

      <Separator />
      <UserIndividualPostingPanel posting={individualPosting} />

      <Separator />
      <UserStoresPanel
        stores={stores}
        user={user}
        onCreated={() => setStoresReloadKey((k) => k + 1)}
      />

      <Separator />
      <UserPaymentsPanel payments={payments} />

      <Separator />
      <UserSupportPanel uid={user.uid} currentUid={currentUid} />

      <Separator />
      <UserAuditPanel entries={audit} />

      {user.isTestAccount && (
        <>
          <Separator />
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mock wallet
              </div>
              <Badge
                variant="outline"
                className="border-purple-200 bg-purple-50 text-[10px] text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200"
              >
                simulation only
              </Badge>
            </div>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-3">
              <div className="flex items-center gap-2">
                <WalletIcon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Balance</span>
              </div>
              <div className="tabular-nums text-lg font-semibold">
                {wallet
                  ? `${wallet.currency} ${wallet.balance.toLocaleString()}`
                  : "…"}
              </div>
            </div>
            <div className="grid max-w-md grid-cols-[1fr_auto] gap-2">
              <Input
                type="number"
                min="0"
                step="1000"
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="Amount to add"
              />
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={applyTopUp}
              >
                Top up <ChevronRight />
              </Button>
            </div>
          </section>
        </>
      )}

      {notifyOpen && (
        <NotifyUserDialog uid={user.uid} onClose={() => setNotifyOpen(false)} />
      )}
      {profileOpen && (
        <EditProfileDialog
          user={user}
          onClose={() => setProfileOpen(false)}
        />
      )}
      {emailOpen && (
        <EditEmailDialog user={user} onClose={() => setEmailOpen(false)} />
      )}
    </div>
  );
}

function EditEmailDialog({
  user,
  onClose,
}: {
  user: PlatformUser;
  onClose: () => void;
}) {
  const [email, setEmail] = useState(user.email ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await updateUserEmail(user.uid, email);
      toast.success("Email updated. Marked unverified.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Change email</h3>
            <p className="text-xs text-muted-foreground">
              Updates Firebase Auth and the Firestore user doc. Resets email
              verification.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-muted-foreground">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="off"
              placeholder="new@example.com"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NotifyUserDialog({
  uid,
  onClose,
}: {
  uid: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    try {
      await notifyUser({ uid, title, body });
      toast.success("Notification sent.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Notify failed.");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Notify this user</h3>
            <p className="text-xs text-muted-foreground">
              Delivers one message to their private inbox.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-start gap-2">
            <label className="w-16 pt-1 text-xs text-muted-foreground">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="What do they need to know?"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button size="sm" onClick={send} disabled={sending}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditProfileDialog({
  user,
  onClose,
}: {
  user: PlatformUser;
  onClose: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [username, setUsername] = useState(user.username ?? "");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await updateUserProfile(user.uid, { name, username });
      toast.success("Profile updated.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Edit profile</h3>
            <p className="text-xs text-muted-foreground">
              Super-admin override for display name and username.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-20 text-xs text-muted-foreground">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="(leave blank to clear)"
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserNotesPanel({ uid }: { uid: string }) {
  const [stored, setStored] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsub = subscribeUserAdminNotes(
      uid,
      (n) => {
        setStored(n);
        setDraft(n);
      },
      () => setStored(""),
    );
    return unsub;
  }, [uid]);

  const dirty = stored !== null && draft !== stored;

  async function save() {
    setSaving(true);
    try {
      await updateUserAdminNotes(uid, draft);
      toast.success("Notes saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Super-admin notes
      </div>
      <p className="text-xs text-muted-foreground">
        Private scratchpad — visible to super-admin only. The target user
        cannot read this, so use it for support context, priors, or notes to
        future-you.
      </p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={5}
        placeholder={stored === null ? "Loading…" : "Nothing recorded yet."}
        disabled={stored === null}
        className="max-w-2xl rounded-md border bg-background px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          className="w-fit"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? "Saving…" : "Save notes"} <ChevronRight />
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            onClick={() => setDraft(stored ?? "")}
          >
            Discard
          </Button>
        )}
      </div>
    </section>
  );
}

function EscalationArchivePanel({
  entries,
}: {
  entries: EscalationArchiveEntry[] | null;
}) {
  return <ArchiveList title="Complaint archive" entries={entries} />;
}

function UserEscalationPanel({ user }: { user: PlatformUser }) {
  const [flag, setFlag] = useState<UserEscalationFlag | "">(
    user.escalationFlag ?? "",
  );
  const [reason, setReason] = useState(user.escalationReason ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFlag(user.escalationFlag ?? "");
    setReason(user.escalationReason ?? "");
  }, [user.escalationFlag, user.escalationReason]);

  async function apply() {
    setBusy(true);
    try {
      await setUserEscalation(
        user.uid,
        flag === "" ? null : (flag as UserEscalationFlag),
        reason,
      );
      toast.success(
        flag === "" ? "Escalation cleared." : "Escalation flag applied.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearFlag() {
    setBusy(true);
    try {
      await setUserEscalation(user.uid, null);
      setFlag("");
      setReason("");
      toast.success("Escalation cleared.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Clear failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Escalation
      </div>
      <p className="text-xs text-muted-foreground">
        Raise a flag when this account needs attention (spam reports, fraud
        suspected, complaint received). Does not restrict access — pair with
        soft-ban or a notify as needed.
      </p>
      {user.escalationFlaggedAt && (
        <p className="text-[11px] text-amber-700">
          Flagged {user.escalationFlaggedAt.toLocaleString()}
        </p>
      )}
      <div className="flex max-w-md flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <label className="w-20 text-xs text-muted-foreground">Kind</label>
          <select
            value={flag}
            onChange={(e) =>
              setFlag(e.target.value as UserEscalationFlag | "")
            }
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="">— none —</option>
            <option value="spam_reports">spam_reports</option>
            <option value="fraud_suspected">fraud_suspected</option>
            <option value="complaint">complaint</option>
            <option value="other">other</option>
          </select>
        </div>
        <div className="flex items-start gap-2">
          <label className="w-20 pt-1 text-xs text-muted-foreground">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Context — where this came from, what to check."
            className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="w-fit"
            disabled={busy || flag === ""}
            onClick={apply}
          >
            {busy ? "Saving…" : user.escalationFlag ? "Update flag" : "Raise flag"}{" "}
            <ChevronRight />
          </Button>
          {user.escalationFlag && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={clearFlag}
            >
              Clear flag <ChevronRight />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function UserContactPanel({
  uid,
  contact,
}: {
  uid: string;
  contact: UserContact | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(kind: "phone" | "whatsapp", next: boolean) {
    setBusy(kind);
    try {
      await setContactVerified(uid, kind, next);
      toast.success(
        `${kind === "phone" ? "Phone" : "WhatsApp"} ${next ? "verified" : "unverified"}.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveValue(kind: "phone" | "whatsapp", value: string) {
    setBusy(kind);
    try {
      await setContactValue(uid, kind, value);
      toast.success(
        `${kind === "phone" ? "Phone" : "WhatsApp"} updated. Marked unverified.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Contact
      </div>
      {contact === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {contact && (
        <div className="flex flex-col gap-2">
          <ContactRow
            label="Phone"
            value={contact.phone}
            verified={contact.phoneVerified}
            busy={busy === "phone"}
            onToggle={() => toggle("phone", !contact.phoneVerified)}
            onSave={(v) => saveValue("phone", v)}
          />
          <ContactRow
            label="WhatsApp"
            value={contact.whatsapp}
            verified={contact.whatsappVerified}
            busy={busy === "whatsapp"}
            onToggle={() => toggle("whatsapp", !contact.whatsappVerified)}
            onSave={(v) => saveValue("whatsapp", v)}
          />
        </div>
      )}
    </section>
  );
}

function ContactRow({
  label,
  value,
  verified,
  busy,
  onToggle,
  onSave,
}: {
  label: string;
  value: string | null;
  verified: boolean;
  busy: boolean;
  onToggle: () => void;
  onSave: (value: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    if (!editing) setDraft(value ?? "");
  }, [value, editing]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      {editing ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="+221…"
          className="flex-1 rounded-md border bg-background px-2 py-1 font-mono text-xs"
        />
      ) : (
        <span className="flex-1 truncate font-mono text-xs">
          {value ?? "—"}
        </span>
      )}
      {!editing && (
        verified ? (
          <Badge
            variant="outline"
            className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          >
            verified
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            unverified
          </Badge>
        )
      )}
      {editing ? (
        <>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={busy || draft.trim() === (value ?? "")}
            onClick={async () => {
              await onSave(draft);
              setEditing(false);
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-fit"
            disabled={busy}
            onClick={() => {
              setDraft(value ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          {value && (
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={busy}
              onClick={onToggle}
            >
              {verified ? "Mark unverified" : "Mark verified"}{" "}
              <ChevronRight />
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function UserGroupsPanel({
  groups,
  user,
}: {
  groups: UserGroupMembership[] | null;
  user: PlatformUser;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const activeOwned = (groups ?? []).find(
    (g) =>
      g.isCreator &&
      (g.groupStatus === "active" ||
        g.groupStatus === "paused" ||
        g.groupStatus === "setup"),
  );
  const blocked = Boolean(activeOwned);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Group memberships ({groups?.length ?? "…"})
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={blocked}
          title={
            blocked
              ? `Already admin of "${activeOwned?.groupName}" (${activeOwned?.groupStatus}). One active group per user.`
              : undefined
          }
          onClick={() => setCreateOpen(true)}
        >
          Create group for this user
        </Button>
      </div>
      {blocked && (
        <p className="text-[11px] text-muted-foreground">
          Already admin of an active group ({activeOwned?.groupName}). Deactivate
          or delete that one before creating another.
        </p>
      )}
      {groups === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {groups && groups.length === 0 && (
        <div className="text-xs text-muted-foreground">
          Not a member of any group.
        </div>
      )}
      {groups && groups.length > 0 && (
        <div className="flex flex-col gap-1">
          {groups.map((g) => (
            <Link
              key={g.groupId}
              href={`/groups/${g.groupId}`}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="flex-1 truncate font-medium">{g.groupName}</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {g.role}
              </Badge>
              <span className="text-xs text-muted-foreground">
                #{g.position} · joined c{g.joinCycle}
              </span>
              {g.payoutCycle != null && (
                <Badge variant="secondary" className="text-[10px]">
                  paid c{g.payoutCycle}
                </Badge>
              )}
              {g.kicked && (
                <Badge variant="destructive" className="text-[10px]">
                  kicked
                </Badge>
              )}
            </Link>
          ))}
        </div>
      )}
      {createOpen && (
        <CreateGroupForUserDialog
          user={user}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </section>
  );
}

function CreateGroupForUserDialog({
  user,
  onClose,
}: {
  user: PlatformUser;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CFA");
  const [frequency, setFrequency] = useState("Monthly");
  const [type, setType] = useState<"traditional" | "secured">("traditional");
  const [startDate, setStartDate] = useState("");
  const [city, setCity] = useState(user.city ?? "");
  const initialCountryEntry = user.country
    ? findCountry({ name: user.country })
    : null;
  const [countryIso, setCountryIso] = useState<string | null>(
    initialCountryEntry?.iso ?? null,
  );
  const [countryName, setCountryName] = useState(
    initialCountryEntry?.name ?? user.country ?? "",
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    const amt = Number(amount);
    if (!name.trim()) return toast.error("Group name required.");
    if (!Number.isFinite(amt) || amt <= 0)
      return toast.error("Amount must be a positive number.");
    setBusy(true);
    try {
      const { groupId } = await createGroupForUser({
        targetUid: user.uid,
        targetName: user.name,
        targetEmail: user.email,
        name,
        description,
        amount: amt,
        currency,
        frequency,
        type,
        startDate: startDate ? new Date(startDate) : null,
        city: city || null,
        country: countryName || null,
      });
      toast.success("Group created on behalf of this user.");
      onClose();
      router.push(`/groups/${groupId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create group failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Create group for {user.name || user.email}
            </h3>
            <p className="text-xs text-muted-foreground">
              Provisions a real-money group with this user as its admin. The
              one-active-group-per-user rule still applies.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <Row label="Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Family tontine"
            />
          </Row>
          <Row label="Description">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </Row>
          <Row label="Amount">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="20000"
            />
          </Row>
          <Row label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="CFA">CFA</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Row>
          <Row label="Frequency">
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Biweekly">Biweekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </Row>
          <Row label="Type">
            <select
              value={type}
              onChange={(e) =>
                setType(e.target.value as "traditional" | "secured")
              }
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="traditional">Traditional (rotating)</option>
              <option value="secured">Secured</option>
            </select>
          </Row>
          <Row label="Start date">
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Row>
          <Row label="City">
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Bamako"
            />
          </Row>
          <Row label="Country">
            <CountrySelect
              value={countryIso}
              onChange={(iso, name) => {
                setCountryIso(iso);
                setCountryName(name);
              }}
              className="flex-1"
            />
          </Row>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create group"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserIndividualPostingPanel({
  posting,
}: {
  posting: StoreListing | null | undefined;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Individual Posting
      </div>
      <p className="text-[11px] text-muted-foreground">
        The single marketplace listing any auth user can post without super
        admin store approval.
      </p>
      {posting === undefined && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {posting === null && (
        <div className="text-xs text-muted-foreground">No individual posting.</div>
      )}
      {posting && (
        <div className="flex items-center gap-3 rounded-md border p-2">
          {posting.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={posting.imageUrl}
              alt=""
              className="h-16 w-16 rounded object-cover"
            />
          ) : (
            <div className="h-16 w-16 rounded bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {posting.title || "(no title)"}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>
                {posting.currency} {posting.price.toLocaleString()}
              </span>
              <span>·</span>
              <span>{posting.category}</span>
              {posting.likedByCount > 0 && (
                <>
                  <span>·</span>
                  <span>♥ {posting.likedByCount}</span>
                </>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {posting.status}
          </Badge>
        </div>
      )}
    </section>
  );
}

function UserStoresPanel({
  stores,
  user,
  onCreated,
}: {
  stores: Store[] | null;
  user: PlatformUser;
  onCreated: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const activeOwned = (stores ?? []).find(
    (s) => s.status === "pending" || s.status === "active" || s.status === "suspended",
  );
  const blocked = Boolean(activeOwned);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Stores ({stores?.length ?? "…"})
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={blocked}
          title={
            blocked
              ? `Already owns "${activeOwned?.storeName}" (${activeOwned?.status}). One store per owner.`
              : undefined
          }
          onClick={() => setCreateOpen(true)}
        >
          Create store for this user
        </Button>
      </div>
      {blocked && (
        <p className="text-[11px] text-muted-foreground">
          Already owns {activeOwned?.storeName} ({activeOwned?.status}). Revoke or
          reject that one before creating another.
        </p>
      )}
      {stores === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {stores && stores.length === 0 && (
        <div className="text-xs text-muted-foreground">No stores.</div>
      )}
      {stores && stores.length > 0 && (
        <div className="flex flex-col gap-1">
          {stores.map((s) => (
            <Link
              key={s.id}
              href={`/store-applications?store=${s.id}`}
              className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className="flex-1 truncate font-medium">{s.storeName}</span>
              <Badge variant="outline" className="text-[10px] uppercase">
                {s.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{s.category}</span>
            </Link>
          ))}
        </div>
      )}
      {createOpen && (
        <CreateStoreForUserDialog
          user={user}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            onCreated();
            setCreateOpen(false);
          }}
        />
      )}
    </section>
  );
}

function CreateStoreForUserDialog({
  user,
  onClose,
  onCreated,
}: {
  user: PlatformUser;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [storeName, setStoreName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!storeName.trim()) return toast.error("Store name required.");
    setBusy(true);
    try {
      await createStoreForUser({
        targetUid: user.uid,
        targetName: user.name || user.email,
        storeName,
        description,
        category,
      });
      toast.success("Store created for this user.");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create store failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">
              Create store for {user.name || user.email}
            </h3>
            <p className="text-xs text-muted-foreground">
              Provisions an active store owned by this user — skips the pending
              review queue. One store per owner still applies.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <Row label="Store name">
            <Input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Aïcha's Boutique"
            />
          </Row>
          <Row label="Category">
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="General"
            />
          </Row>
          <Row label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
              className="flex-1"
              rows={3}
            />
          </Row>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !storeName.trim()}>
            {busy ? "Creating…" : "Create store"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-24 text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function UserPaymentsPanel({
  payments,
}: {
  payments: UserPaymentEntry[] | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Payment activity ({payments?.length ?? "…"})
      </div>
      {payments === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {payments && payments.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No contributions or payouts recorded for this user.
        </div>
      )}
      {payments && payments.length > 0 && (
        <div className="flex max-h-96 flex-col gap-1 overflow-auto">
          {payments.map((p) => {
            const voided = p.status === "voided";
            return (
              <Link
                key={p.id}
                href={`/groups/${p.groupId}`}
                className={
                  "flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs hover:bg-muted/50 " +
                  (voided ? "opacity-60 line-through" : "")
                }
              >
                <span className="font-mono text-muted-foreground">
                  c{p.cycleNumber}
                </span>
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                    (p.type === "payout"
                      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200")
                  }
                >
                  {p.type}
                </span>
                <span className="flex-1 truncate font-mono text-[10px]">
                  group {p.groupId.slice(0, 8)}…
                </span>
                {p.isLate && (
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    late
                  </span>
                )}
                {voided && (
                  <span className="rounded bg-red-100 px-1 text-[10px] text-red-800 dark:bg-red-950 dark:text-red-200">
                    voided
                  </span>
                )}
                <span className="font-mono">
                  {p.currency} {p.amount.toLocaleString()}
                </span>
                {p.paidAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {p.paidAt.toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function UserSupportPanel({
  uid,
  currentUid,
}: {
  uid: string;
  currentUid: string | null;
}) {
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const unsub = subscribeSupportMessages(
      uid,
      setMessages,
      30,
      () => setMessages([]),
    );
    return unsub;
  }, [uid]);

  async function send() {
    setSending(true);
    try {
      await sendSupportMessage(uid, draft);
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Support conversation ({messages?.length ?? "…"})
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded-md border bg-muted/20 p-2">
        {messages === null && (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}
        {messages && messages.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No support messages yet. Send one below.
          </div>
        )}
        {messages?.map((m) => {
          const mine = m.senderId === currentUid;
          return (
            <div
              key={m.id}
              className={
                "flex flex-col rounded-md px-2 py-1.5 text-sm " +
                (mine
                  ? "self-end bg-primary/10 text-right"
                  : "self-start bg-background border")
              }
            >
              <span className="whitespace-pre-wrap">{m.text}</span>
              {m.createdAt && (
                <span className="text-[10px] text-muted-foreground">
                  {mine ? "you · " : ""}
                  {m.createdAt.toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex max-w-2xl gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Reply to this user…"
          className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
        />
        <Button
          size="sm"
          className="w-fit"
          disabled={sending || !draft.trim()}
          onClick={send}
        >
          {sending ? "Sending…" : "Send"} <ChevronRight />
        </Button>
      </div>
    </section>
  );
}

function UserAuditPanel({ entries }: { entries: AuditEntry[] | null }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Audit trail ({entries?.length ?? "…"})
      </div>
      {entries === null && (
        <div className="text-xs text-muted-foreground">Loading…</div>
      )}
      {entries && entries.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No super-admin actions recorded for this user.
        </div>
      )}
      {entries && entries.length > 0 && (
        <div className="flex max-h-72 flex-col gap-1 overflow-auto">
          {entries.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs"
            >
              <Badge variant="outline" className="text-[10px] uppercase">
                {e.action.replace(/_/g, " ")}
              </Badge>
              {e.reason && (
                <span className="flex-1 truncate italic text-muted-foreground">
                  {e.reason}
                </span>
              )}
              {!e.reason && (
                <span className="flex-1 truncate text-muted-foreground">
                  {e.actorUid ? `by ${e.actorUid.slice(0, 8)}…` : ""}
                </span>
              )}
              {e.createdAt && (
                <span className="text-[10px] text-muted-foreground">
                  {e.createdAt.toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtRelative(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={mono ? "truncate font-mono text-xs" : "text-sm"}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
