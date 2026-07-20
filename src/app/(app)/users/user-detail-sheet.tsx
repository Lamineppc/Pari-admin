"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldOff, ShieldAlert, ShieldCheck, Beaker, Wallet as WalletIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  exitSimulationEnvironment,
  forceSignOutUser,
  hardDeleteUser,
  setUserBan,
  setUserIsTestAccount,
  type BanType,
  type PlatformUser,
} from "@/lib/users";
import { LogOut, Trash2 } from "lucide-react";
import {
  mockPaymentProvider,
  userWalletId,
  type Wallet,
} from "@/lib/money/mock/mock-payment-provider";
import { writeAudit } from "@/lib/audit";

export function UserDetailSheet({
  user,
  currentUid,
  onOpenChange,
}: {
  user: PlatformUser | null;
  currentUid: string | null;
  onOpenChange: (open: boolean) => void;
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
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.isTestAccount) {
      setWallet(null);
      return;
    }
    const unsub = mockPaymentProvider.subscribeWallet(
      userWalletId(user.uid),
      setWallet,
    );
    return unsub;
  }, [user?.uid, user?.isTestAccount]);

  if (!user) return null;
  const isSelf = user.uid === currentUid;
  const isBanned = user.banType !== null;
  const location = [user.city, user.state, user.country].filter(Boolean).join(", ");

  async function apply(kind: BanType | "restore") {
    setBusy(kind);
    try {
      const nextBan: BanType | null = kind === "restore" ? null : kind;
      await setUserBan(user!.uid, nextBan, reason);
      toast.success(
        kind === "restore"
          ? "Access restored."
          : kind === "soft"
            ? "Access limited."
            : "Access revoked.",
      );
      setReason("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function applyExitSimulation() {
    if (!user) return;
    if (
      !window.confirm(
        `Remove ${user.name || user.email} from every mock group and flip isTestAccount back to false?`,
      )
    ) return;
    setBusy("exit-sim");
    try {
      const n = await exitSimulationEnvironment(user.uid);
      toast.success(
        n > 0
          ? `Removed from ${n} mock group(s) and reset to a real account.`
          : "Reset to a real account. No mock-group memberships found.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function applyForceSignOut() {
    if (!user) return;
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
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function applyHardDelete() {
    if (!user) return;
    if (
      !window.confirm(
        `HARD-DELETE ${user.name || user.email} (${user.uid})?\n\nRemoves the Firestore user doc, private/contact subdoc, and Firebase Auth account. Group memberships and past payments stay as historical references. This cannot be undone.`,
      )
    )
      return;
    const reason = window.prompt(
      "Reason for hard-delete (recorded in the audit trail):",
      "",
    );
    if (reason === null) return;
    setBusy("hard-delete");
    try {
      await hardDeleteUser(user.uid, reason.trim() || undefined);
      toast.success("User hard-deleted.");
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function applyToggleTest() {
    if (!user) return;
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
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
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
        walletId: userWalletId(user!.uid),
        amount,
      });
      await writeAudit({
        action: "top_up_wallet",
        targetType: "wallet",
        targetId: userWalletId(user!.uid),
        test: true,
        after: { amount, currency: "CFA" },
        metadata: { userUid: user!.uid },
      });
      toast.success(`Topped up ${amount.toLocaleString()} CFA.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!user} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {user.name || "(no name)"}
            {isBanned && (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {user.banType === "hard" ? "Hard ban" : "Soft ban"}
              </Badge>
            )}
            {user.isTestAccount && (
              <Badge variant="outline" className="border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                <Beaker className="mr-1 h-3 w-3" />
                Test account
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Username" value={user.username ?? "—"} />
            <Field label="Location" value={location || "—"} />
            <Field label="uid" value={user.uid} mono />
          </div>

          {isBanned && user.banReason && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
              <div className="font-medium text-red-800 dark:text-red-200">Current reason</div>
              <div className="mt-1 text-red-700 dark:text-red-300">{user.banReason}</div>
            </div>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
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
                <div className="grid gap-2">
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
                >
                  <ShieldAlert /> Limit access (soft ban)
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => apply("hard")}
                >
                  <ShieldOff /> Revoke access (hard ban)
                </Button>
              </>
            )}

            {!isSelf && isBanned && (
              <Button
                variant="default"
                disabled={busy !== null}
                onClick={() => apply("restore")}
              >
                <ShieldCheck /> Restore access
              </Button>
            )}
          </div>

          {!isSelf && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Session
                </div>
                <p className="text-xs text-muted-foreground">
                  Force sign-out revokes every active refresh token. The user
                  stays in Firestore and can sign back in normally; existing
                  sessions on their devices die on the next backend call.
                </p>
                <Button
                  variant="outline"
                  disabled={busy !== null}
                  onClick={applyForceSignOut}
                >
                  <LogOut /> Force sign-out
                </Button>
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Danger zone
                </div>
                <p className="text-xs text-muted-foreground">
                  Hard-delete removes the Firestore user doc, the private
                  contact subdoc, and the Firebase Auth account. Historical
                  references (group memberships, payments) stay put so audit
                  trails are preserved.
                </p>
                <Button
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={applyHardDelete}
                >
                  <Trash2 /> Hard-delete account
                </Button>
              </div>
              <Separator />
              <div className="flex flex-col gap-2">
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
                >
                  <Beaker />{" "}
                  {user.isTestAccount
                    ? "Convert to real account"
                    : "Convert to test account"}
                </Button>
                {user.isTestAccount && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy !== null}
                      onClick={applyExitSimulation}
                    >
                      <LogOut /> Exit simulation environment
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                      Removes this uid from every mock group&apos;s memberIds
                      + member docs and flips isTestAccount back to false in
                      one go.
                    </p>
                  </>
                )}
              </div>
            </>
          )}

          {user.isTestAccount && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Mock wallet
                  </div>
                  <Badge variant="outline" className="border-purple-200 bg-purple-50 text-[10px] text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
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
                <div className="grid grid-cols-[1fr_auto] gap-2">
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
                    Top up
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono text-xs" : "text-sm"} title={value}>
        {value}
      </span>
    </div>
  );
}
