"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bell, LogOut, Search, ShieldAlert, ShieldCheck, ShieldOff, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  forceSignOutUser,
  notifyUser,
  setUserBan,
  subscribeUsers,
  type PlatformUser,
} from "@/lib/users";
import { useAuth } from "@/lib/auth-context";
import { BulkActionBar } from "@/components/bulk-action-bar";

export default function UsersPage() {
  const { user: authUser } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [q, setQ] = useState("");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    const unsub = subscribeUsers(setUsers, (e) => {
      toast.error(e.message);
      setUsers([]);
    });
    return unsub;
  }, []);

  // Deep-link support: global search sends users here with ?selected=<uid>.
  // Forwards to the new full-page detail route so the URL is shareable.
  useEffect(() => {
    const sel = searchParams.get("selected");
    if (sel) router.replace(`/users/${sel}`);
  }, [searchParams, router]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.uid.toLowerCase().includes(needle) ||
        (u.username?.toLowerCase().includes(needle) ?? false),
    );
  }, [users, q]);

  const allVisibleChecked =
    filtered !== null && filtered.length > 0 && filtered.every((u) => checkedIds.has(u.uid));

  function toggleOne(uid: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  function toggleAllVisible() {
    if (!filtered) return;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleChecked) {
        for (const u of filtered) next.delete(u.uid);
      } else {
        for (const u of filtered) next.add(u.uid);
      }
      return next;
    });
  }

  async function runBulk(kind: "soft" | "hard" | "restore") {
    const targets = Array.from(checkedIds).filter(
      (uid) => uid !== authUser?.uid, // never touch self
    );
    if (targets.length === 0) {
      toast.error("Nothing to apply — self-selection is skipped.");
      return;
    }
    const label = kind === "restore" ? "restore access" : kind === "soft" ? "soft-ban" : "hard-ban";
    if (!window.confirm(`Apply ${label} to ${targets.length} user(s)?`)) return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (uid) => {
        try {
          await setUserBan(uid, kind === "restore" ? null : kind, "");
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBusy(false);
    setCheckedIds(new Set());
    toast.success(`${label} applied to ${ok} user(s)${failed > 0 ? `, ${failed} failed` : ""}.`);
  }

  async function runBulkForceSignOut() {
    const targets = Array.from(checkedIds).filter(
      (uid) => uid !== authUser?.uid,
    );
    if (targets.length === 0) {
      toast.error("Nothing to apply — self-selection is skipped.");
      return;
    }
    if (
      !window.confirm(
        `Force sign-out ${targets.length} user(s)? Every active session for each gets revoked and their mobile app bounces to login within a couple of seconds.`,
      )
    )
      return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (uid) => {
        try {
          await forceSignOutUser(uid);
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBusy(false);
    setCheckedIds(new Set());
    toast.success(
      `Signed out ${ok} user(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
  }

  async function runBulkNotify(title: string, body: string) {
    const targets = Array.from(checkedIds).filter(
      (uid) => uid !== authUser?.uid,
    );
    if (targets.length === 0) {
      toast.error("Nothing to send — self-selection is skipped.");
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    // Chunk so we don't fire hundreds of parallel writes on large
    // selections — writes both the private inbox doc and the
    // read-only Pari conversation per uid.
    const CHUNK = 25;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (uid) => {
          try {
            await notifyUser({ uid, title, body });
            ok += 1;
          } catch {
            failed += 1;
          }
        }),
      );
    }
    setBusy(false);
    setCheckedIds(new Set());
    setNotifyOpen(false);
    toast.success(
      `Notified ${ok} user(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground">
              Every registered account. Click a row to view details, or tick the
              checkboxes for bulk actions.
            </p>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, username, or uid…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <div
                  role="checkbox"
                  aria-checked={allVisibleChecked}
                  tabIndex={0}
                  onClick={toggleAllVisible}
                  className="inline-flex cursor-pointer items-center justify-center"
                >
                  <Checkbox checked={allVisibleChecked} tabIndex={-1} />
                </div>
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && <LoadingRows />}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  {q ? "No users match your search." : "No users yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((u) => {
              const location = [u.city, u.state, u.country].filter(Boolean).join(", ");
              const isChecked = checkedIds.has(u.uid);
              return (
                <TableRow
                  key={u.uid}
                  onClick={() => router.push(`/users/${u.uid}`)}
                  className="cursor-pointer"
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div
                      role="checkbox"
                      aria-checked={isChecked}
                      tabIndex={0}
                      onClick={() => toggleOne(u.uid)}
                      className="inline-flex cursor-pointer items-center justify-center"
                    >
                      <Checkbox checked={isChecked} tabIndex={-1} />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{u.name || "(no name)"}</TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground" title={u.email}>
                    {u.email || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.username ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {location || "—"}
                  </TableCell>
                  <TableCell>
                    {u.banType === "hard" ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                        Hard ban
                      </Badge>
                    ) : u.banType === "soft" ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Soft ban
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <BulkActionBar count={checkedIds.size} onClear={() => setCheckedIds(new Set())}>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => runBulk("soft")}
        >
          <ShieldAlert /> Soft ban
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => runBulk("hard")}
        >
          <ShieldOff /> Hard ban
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy}
          onClick={() => runBulk("restore")}
        >
          <ShieldCheck /> Restore
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setNotifyOpen(true)}
        >
          <Bell /> Notify
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={runBulkForceSignOut}
        >
          <LogOut /> Force sign-out
        </Button>
      </BulkActionBar>

      {notifyOpen && (
        <BulkNotifyDialog
          count={
            Array.from(checkedIds).filter((uid) => uid !== authUser?.uid).length
          }
          onSend={runBulkNotify}
          onClose={() => setNotifyOpen(false)}
          busy={busy}
        />
      )}
    </div>
  );
}

function BulkNotifyDialog({
  count,
  busy,
  onSend,
  onClose,
}: {
  count: number;
  busy: boolean;
  onSend: (title: string, body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Notify {count} user(s)</h3>
            <p className="text-xs text-muted-foreground">
              Writes to each recipient&apos;s private inbox and read-only Pari
              chat.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline"
            />
          </div>
          <div className="flex items-start gap-2">
            <label className="w-16 pt-1 text-xs text-muted-foreground">
              Body
            </label>
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
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !title.trim() || !body.trim()}
            onClick={() => onSend(title, body)}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={6}>
            <Skeleton className="h-6 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
