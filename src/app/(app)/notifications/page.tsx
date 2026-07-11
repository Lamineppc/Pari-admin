"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, Megaphone, Search } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  sendBroadcast,
  subscribeAllNotifications,
  type BroadcastTarget,
  type Notification,
} from "@/lib/notifications";

export default function NotificationsPage() {
  const [entries, setEntries] = useState<Notification[] | null>(null);
  const [q, setQ] = useState("");
  const [hideRead, setHideRead] = useState(false);

  useEffect(() => {
    const unsub = subscribeAllNotifications(
      setEntries,
      300,
      (e) => {
        toast.error(e.message);
        setEntries([]);
      },
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    if (!entries) return null;
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (hideRead && e.isRead) return false;
      if (!needle) return true;
      return (
        e.title.toLowerCase().includes(needle) ||
        e.body.toLowerCase().includes(needle) ||
        e.userId.toLowerCase().includes(needle) ||
        e.type.toLowerCase().includes(needle)
      );
    });
  }, [entries, q, hideRead]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Bell className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Every notification sent to any user across the platform. Live
              updates. Use Compose broadcast to push a platform-wide
              announcement.
            </p>
          </div>
          <BroadcastDialog />
        </div>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search recipient / title / body / type…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            onClick={() => setHideRead((v) => !v)}
          >
            <Checkbox checked={hideRead} tabIndex={-1} />
            Hide read
          </label>
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Body</TableHead>
              <TableHead>Read</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            )}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                  No notifications match the current filters.
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((e) => (
              <TableRow key={`${e.userId}:${e.id}`}>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {e.createdAt?.toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }) ?? "—"}
                </TableCell>
                <TableCell className="truncate font-mono text-[10px]" title={e.userId}>
                  {e.userId.length > 16 ? `${e.userId.slice(0, 16)}…` : e.userId}
                </TableCell>
                <TableCell className="text-xs">
                  <Badge variant="secondary" className="text-[10px]">
                    {e.type || "—"}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm font-medium">{e.title || "—"}</TableCell>
                <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={e.body}>
                  {e.body || "—"}
                </TableCell>
                <TableCell>
                  {e.isRead ? (
                    <Badge variant="secondary" className="text-[10px]">read</Badge>
                  ) : (
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                      unread
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function BroadcastDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<BroadcastTarget>("real");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!window.confirm(`Send this broadcast to every ${target === "all" ? "user" : target === "real" ? "real user" : "test user"}?`)) return;
    setBusy(true);
    try {
      const r = await sendBroadcast({ title, body, target });
      toast.success(`Delivered ${r.sent} / ${r.totalTargets}.`);
      setOpen(false);
      setTitle("");
      setBody("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm">
            <Megaphone /> Compose broadcast
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4" />
            Compose broadcast
          </DialogTitle>
          <DialogDescription>
            One notification per target user, delivered to their in-app inbox.
            Can&apos;t be recalled after sending.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="broadcast-target">Send to</Label>
            <div className="flex gap-2">
              {(["real", "all", "test"] as BroadcastTarget[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={target === t ? "default" : "outline"}
                  onClick={() => setTarget(t)}
                >
                  {t === "all" ? "All users" : t === "real" ? "Real users only" : "Test users only"}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="broadcast-title">Title</Label>
            <Input
              id="broadcast-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Orange Money outage 14:00–16:00"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="broadcast-body">Body</Label>
            <Textarea
              id="broadcast-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Full message text."
              rows={4}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send broadcast"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
