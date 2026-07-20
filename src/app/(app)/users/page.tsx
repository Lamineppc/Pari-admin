"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bell,
  Download,
  Flag,
  FlagOff,
  LogOut,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Users,
  X,
} from "lucide-react";
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
  createUserAsSuperAdmin,
  forceSignOutUser,
  notifyUser,
  setUserBan,
  setUserEscalation,
  subscribeUsers,
  type PlatformUser,
  type UserEscalationFlag,
} from "@/lib/users";
import { useAuth } from "@/lib/auth-context";
import { BulkActionBar } from "@/components/bulk-action-bar";

export default function UsersPage() {
  const { user: authUser } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<
    "all" | "active" | "banned" | "escalated" | "test"
  >("all");
  const [sortKey, setSortKey] = useState<"name" | "lastActive" | "createdAt">(
    "name",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
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

  // Dashboard tiles link here with ?filter=<kind> to preselect the chip.
  useEffect(() => {
    const f = searchParams.get("filter");
    if (
      f === "all" ||
      f === "active" ||
      f === "banned" ||
      f === "escalated" ||
      f === "test"
    ) {
      setFilter(f);
    }
  }, [searchParams]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const byKind = users.filter((u) => {
      switch (filter) {
        case "all":
          return true;
        case "active":
          return u.banType === null;
        case "banned":
          return u.banType !== null;
        case "escalated":
          return u.escalationFlag !== null;
        case "test":
          return u.isTestAccount;
      }
    });
    const needle = q.trim().toLowerCase();
    const bySearch = !needle
      ? byKind
      : byKind.filter(
          (u) =>
            u.name.toLowerCase().includes(needle) ||
            u.email.toLowerCase().includes(needle) ||
            u.uid.toLowerCase().includes(needle) ||
            (u.username?.toLowerCase().includes(needle) ?? false),
        );
    const sorted = [...bySearch].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = (a.name || "").localeCompare(b.name || "");
      } else if (sortKey === "lastActive") {
        cmp =
          (a.lastActiveAt?.getTime() ?? 0) - (b.lastActiveAt?.getTime() ?? 0);
      } else {
        cmp = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [users, q, filter, sortKey, sortDir]);

  const counts = useMemo(() => {
    if (!users) return null;
    return {
      all: users.length,
      active: users.filter((u) => u.banType === null).length,
      banned: users.filter((u) => u.banType !== null).length,
      escalated: users.filter((u) => u.escalationFlag !== null).length,
      test: users.filter((u) => u.isTestAccount).length,
    };
  }, [users]);

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

  function exportCsv() {
    if (!filtered || filtered.length === 0) {
      toast.error("Nothing to export in the current view.");
      return;
    }
    const header = [
      "uid",
      "name",
      "email",
      "username",
      "city",
      "country",
      "isTestAccount",
      "banType",
      "escalationFlag",
      "escalationReason",
      "createdAt",
      "lastActiveAt",
    ];
    const rows = filtered.map((u) => [
      u.uid,
      u.name,
      u.email,
      u.username ?? "",
      u.city ?? "",
      u.country ?? "",
      u.isTestAccount ? "true" : "false",
      u.banType ?? "",
      u.escalationFlag ?? "",
      u.escalationReason ?? "",
      u.createdAt?.toISOString() ?? "",
      u.lastActiveAt?.toISOString() ?? "",
    ]);
    const esc = (s: string) =>
      /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const csv = [header, ...rows]
      .map((r) => r.map((c) => esc(String(c))).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pari-users-${filter}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} row(s).`);
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

  async function runBulkEscalate(flag: UserEscalationFlag, reason: string) {
    const targets = Array.from(checkedIds).filter(
      (uid) => uid !== authUser?.uid,
    );
    if (targets.length === 0) {
      toast.error("Nothing to flag — self-selection is skipped.");
      return;
    }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (uid) => {
        try {
          await setUserEscalation(uid, flag, reason);
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBusy(false);
    setCheckedIds(new Set());
    setEscalateOpen(false);
    toast.success(
      `Flagged ${ok} user(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
    );
  }

  async function runBulkClearEscalation() {
    const targets = Array.from(checkedIds).filter(
      (uid) => uid !== authUser?.uid,
    );
    if (targets.length === 0) {
      toast.error("Nothing to clear — self-selection is skipped.");
      return;
    }
    if (!window.confirm(`Clear escalation on ${targets.length} user(s)?`))
      return;
    setBusy(true);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      targets.map(async (uid) => {
        try {
          await setUserEscalation(uid, null);
          ok += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    setBusy(false);
    setCheckedIds(new Set());
    toast.success(
      `Cleared ${ok} escalation(s)${failed > 0 ? `, ${failed} failed` : ""}.`,
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
        <div className="flex flex-wrap gap-1.5 text-xs">
          {(
            [
              ["all", "All"],
              ["active", "Active"],
              ["banned", "Banned"],
              ["escalated", "Escalated"],
              ["test", "Test"],
            ] as const
          ).map(([key, label]) => {
            const active = filter === key;
            const count = counts?.[key];
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={
                  "rounded-full border px-3 py-1 " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted")
                }
              >
                {label}
                {count !== undefined && (
                  <span className="ml-1 text-[10px] opacity-70">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, username, or uid…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            title="Export the current view as CSV"
          >
            <Download /> Export CSV
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus /> New user
          </Button>
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
              <SortableHead
                label="Name"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => {
                  if (sortKey === "name") {
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  } else {
                    setSortKey("name");
                    setSortDir("asc");
                  }
                }}
              />
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Location</TableHead>
              <SortableHead
                label="Last active"
                active={sortKey === "lastActive"}
                dir={sortDir}
                onClick={() => {
                  if (sortKey === "lastActive") {
                    setSortDir(sortDir === "asc" ? "desc" : "asc");
                  } else {
                    setSortKey("lastActive");
                    setSortDir("desc");
                  }
                }}
              />
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && <LoadingRows />}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
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
                  <TableCell className="text-xs text-muted-foreground">
                    {formatRelative(u.lastActiveAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
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
                      {u.escalationFlag && (
                        <Badge
                          variant="outline"
                          className="border-amber-300 bg-amber-50 text-[10px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                          title={u.escalationReason ?? undefined}
                        >
                          ⚠ {u.escalationFlag.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </div>
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
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setEscalateOpen(true)}
        >
          <Flag /> Escalate
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={runBulkClearEscalation}
        >
          <FlagOff /> Clear escalation
        </Button>
      </BulkActionBar>

      {createOpen && (
        <CreateUserDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(uid) => {
            setCreateOpen(false);
            router.push(`/users/${uid}`);
          }}
        />
      )}
      {escalateOpen && (
        <BulkEscalateDialog
          count={
            Array.from(checkedIds).filter((uid) => uid !== authUser?.uid).length
          }
          busy={busy}
          onSend={runBulkEscalate}
          onClose={() => setEscalateOpen(false)}
        />
      )}
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

function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (uid: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!email.trim()) {
      toast.error("Email required.");
      return;
    }
    setBusy(true);
    try {
      const uid = await createUserAsSuperAdmin({
        email: email.trim(),
        name: name.trim() || undefined,
        password: password.trim() || undefined,
      });
      toast.success(
        password.trim()
          ? "User created with the password you provided."
          : "User created. Send a password reset email from their detail page.",
      );
      onCreated(uid);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Create user failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Create user</h3>
            <p className="text-xs text-muted-foreground">
              Provisions the Firebase Auth account and stamps the Firestore
              user doc. Leave password blank to have the panel auto-generate
              one and email the user a reset link on their detail page.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="member@example.com"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="w-24 text-xs text-muted-foreground">
              Password
            </label>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="(auto-generate if blank)"
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !email.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BulkEscalateDialog({
  count,
  busy,
  onSend,
  onClose,
}: {
  count: number;
  busy: boolean;
  onSend: (flag: UserEscalationFlag, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [flag, setFlag] = useState<UserEscalationFlag>("complaint");
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold">Flag {count} user(s)</h3>
            <p className="text-xs text-muted-foreground">
              Raises the escalation flag on each. Doesn&apos;t restrict access —
              pair with soft-ban if needed.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="w-16 text-xs text-muted-foreground">Kind</label>
            <select
              value={flag}
              onChange={(e) =>
                setFlag(e.target.value as UserEscalationFlag)
              }
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
            >
              <option value="spam_reports">spam_reports</option>
              <option value="fraud_suspected">fraud_suspected</option>
              <option value="complaint">complaint</option>
              <option value="other">other</option>
            </select>
          </div>
          <div className="flex items-start gap-2">
            <label className="w-16 pt-1 text-xs text-muted-foreground">
              Reason
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Context recorded on each flagged account."
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
            disabled={busy}
            onClick={() => onSend(flag, reason)}
          >
            {busy ? "Flagging…" : "Flag"}
          </Button>
        </div>
      </div>
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

function SortableHead({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <TableHead>
      <button
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 " +
          (active ? "text-foreground" : "text-muted-foreground")
        }
      >
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </TableHead>
  );
}

function formatRelative(d: Date | null): string {
  if (!d) return "—";
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={7}>
            <Skeleton className="h-6 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
