"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Beaker,
  Bell,
  ChevronRight,
  KeyRound,
  LogOut,
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
  hardDeleteUser,
  notifyUser,
  sendPasswordReset,
  setContactVerified,
  setUserBan,
  setUserIsTestAccount,
  subscribeUserContact,
  subscribeUserGroups,
  subscribeUserPayments,
  updateUserProfile,
  type BanType,
  type PlatformUser,
  type UserContact,
  type UserGroupMembership,
  type UserPaymentEntry,
} from "@/lib/users";
import Link from "next/link";

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
    | "exit-sim"
    | "force-signout"
    | "hard-delete"
    | "reset-pw"
    | null
  >(null);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("50000");
  const [groups, setGroups] = useState<UserGroupMembership[] | null>(null);
  const [payments, setPayments] = useState<UserPaymentEntry[] | null>(null);
  const [contact, setContact] = useState<UserContact | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

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
    const unsub = subscribeUserGroups(user.uid, setGroups, () => setGroups([]));
    return unsub;
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
        </div>
        <p className="text-sm text-muted-foreground">{user.email}</p>
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
          </section>
        </>
      )}

      <Separator />
      <UserContactPanel uid={user.uid} contact={contact} />

      <Separator />
      <UserGroupsPanel groups={groups} />

      <Separator />
      <UserPaymentsPanel payments={payments} />

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
          />
          <ContactRow
            label="WhatsApp"
            value={contact.whatsapp}
            verified={contact.whatsappVerified}
            busy={busy === "whatsapp"}
            onToggle={() => toggle("whatsapp", !contact.whatsappVerified)}
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
}: {
  label: string;
  value: string | null;
  verified: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <span className="w-20 text-xs text-muted-foreground">{label}</span>
      <span className="flex-1 truncate font-mono text-xs">
        {value ?? "—"}
      </span>
      {verified ? (
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
      )}
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
    </div>
  );
}

function UserGroupsPanel({ groups }: { groups: UserGroupMembership[] | null }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Group memberships ({groups?.length ?? "…"})
      </div>
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
    </section>
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
