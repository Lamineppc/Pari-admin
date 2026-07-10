"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldOff, ShieldAlert, ShieldCheck } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { setUserBan, type BanType, type PlatformUser } from "@/lib/users";

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
  const [busy, setBusy] = useState<BanType | "restore" | null>(null);

  useEffect(() => {
    setReason("");
  }, [user?.uid]);

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

  return (
    <Sheet open={!!user} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {user.name || "(no name)"}
            {isBanned && (
              <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {user.banType === "hard" ? "Hard ban" : "Soft ban"}
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
