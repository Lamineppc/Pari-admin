"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Beaker,
  ChevronRight,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Wallet as WalletIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { writeAudit } from "@/lib/audit";
import {
  mockPaymentProvider,
  userWalletId,
  type Wallet,
} from "@/lib/money/mock/mock-payment-provider";
import {
  exitSimulationEnvironment,
  forceSignOutUser,
  hardDeleteUser,
  setUserBan,
  setUserIsTestAccount,
  type BanType,
  type PlatformUser,
} from "@/lib/users";

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
    | null
  >(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [topUpAmount, setTopUpAmount] = useState("50000");

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
      </div>

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
    </div>
  );
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
