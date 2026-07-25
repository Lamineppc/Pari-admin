"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  MessageSquare,
  Pause,
  Send,
  User as UserIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  addInternalNote,
  replyToTicket,
  setTicketPriority,
  setTicketStatus,
  subscribeTicket,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support";

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
  normal:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  high: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  urgent:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  in_progress:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  resolved:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  closed:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

export default function TicketDetailPage() {
  const params = useParams<{ ticketId: string }>();
  const router = useRouter();
  const [ticket, setTicket] = useState<SupportTicket | null | undefined>(
    undefined,
  );
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<
    "reply" | "note" | "status" | "priority" | null
  >(null);

  useEffect(() => {
    if (!params.ticketId) return;
    const unsub = subscribeTicket(params.ticketId, setTicket, (e) => {
      toast.error(e.message);
      setTicket(null);
    });
    return unsub;
  }, [params.ticketId]);

  useEffect(() => {
    setReply("");
    setNote("");
  }, [params.ticketId]);

  async function withBusy<T>(
    kind: "reply" | "note" | "status" | "priority",
    fn: () => Promise<T>,
    ok: string,
  ) {
    setBusy(kind);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (ticket === undefined) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (ticket === null) {
    return (
      <div className="mx-auto max-w-4xl">
        <p className="text-sm text-muted-foreground">Ticket not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/support")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Support
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {ticket.subject || "(no subject)"}
          </h1>
          <Badge variant="outline" className={PRIORITY_STYLES[ticket.priority]}>
            {ticket.priority}
          </Badge>
          <Badge variant="outline" className={STATUS_STYLES[ticket.status]}>
            {ticket.status.replace("_", " ")}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          From {ticket.userName || ticket.userEmail || ticket.userId} —{" "}
          {ticket.createdAt?.toLocaleString() ?? "unknown time"}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        {/* Left column — body + reply + notes */}
        <div className="flex flex-col gap-5">
          <section className="rounded-md border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Body
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.body || "(empty)"}
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-md border p-4">
            <div className="flex items-center gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reply to user
              </div>
              <Badge variant="outline" className="text-[10px]">
                delivered as in-app notification
              </Badge>
            </div>
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply. Sent to the user's inbox and recorded on the ticket."
              rows={5}
            />
            <Button
              variant="default"
              size="sm"
              className="self-start"
              disabled={busy !== null || reply.trim().length === 0}
              onClick={() =>
                withBusy(
                  "reply",
                  async () => {
                    await replyToTicket(ticket.id, reply);
                    setReply("");
                  },
                  "Reply sent to user.",
                )
              }
            >
              <Send /> Send reply
            </Button>
            {ticket.replies.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Reply history ({ticket.replies.length})
                </div>
                {ticket.replies.map((r, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2 text-xs">
                    <div className="text-[10px] text-muted-foreground">
                      {r.authorEmail || r.authorUid.slice(0, 12)} ·{" "}
                      {r.createdAt?.toLocaleString() ?? "—"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{r.body}</div>
                  </div>
                ))}
              </div>
            )}
            {ticket.replies.length === 0 && ticket.lastReply && (
              <div className="mt-2 rounded-md border bg-muted/30 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Last reply · {ticket.lastReplyAt?.toLocaleString() ?? "—"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{ticket.lastReply}</div>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2 rounded-md border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Internal notes ({ticket.internalNotes.length})
            </div>
            {ticket.internalNotes.length > 0 && (
              <div className="flex flex-col gap-2">
                {ticket.internalNotes.map((n, i) => (
                  <div key={i} className="rounded-md border bg-muted/30 p-2 text-xs">
                    <div className="text-[10px] text-muted-foreground">
                      {n.authorEmail || n.authorUid.slice(0, 12)} ·{" "}
                      {n.createdAt?.toLocaleString() ?? "—"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 grid gap-2">
              <Label htmlFor="note">Add note</Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Internal-only note. Never shown to the user."
                rows={3}
              />
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                disabled={busy !== null || note.trim().length === 0}
                onClick={() =>
                  withBusy(
                    "note",
                    async () => {
                      await addInternalNote(ticket.id, note);
                      setNote("");
                    },
                    "Note added.",
                  )
                }
              >
                <MessageSquare /> Add note
              </Button>
            </div>
          </section>
        </div>

        {/* Right column — status/priority + related entities */}
        <aside className="flex flex-col gap-4">
          <section className="rounded-md border p-4">
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                User
              </div>
            </div>
            <div className="mt-2 text-sm">
              {ticket.userName || ticket.userEmail || ticket.userId}
            </div>
            <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {ticket.userId}
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-3 w-full"
            >
              <Link href={`/users/${ticket.userId}`}>
                Open user <ArrowRight className="ml-auto h-4 w-4" />
              </Link>
            </Button>
          </section>

          {ticket.groupId && (
            <section className="rounded-md border p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                About group
              </div>
              <div className="mt-1 truncate font-mono text-[10px]">
                {ticket.groupId}
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="mt-3 w-full"
              >
                <Link href={`/groups/${ticket.groupId}`}>
                  Open group <ArrowRight className="ml-auto h-4 w-4" />
                </Link>
              </Button>
            </section>
          )}

          <section className="rounded-md border p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Status
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                ["open", "in_progress", "resolved", "closed"] as TicketStatus[]
              ).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={ticket.status === s ? "default" : "outline"}
                  disabled={busy !== null}
                  onClick={() =>
                    withBusy(
                      "status",
                      () => setTicketStatus(ticket.id, s),
                      `Marked ${s.replace("_", " ")}.`,
                    )
                  }
                >
                  {s === "resolved" ? (
                    <CheckCircle2 />
                  ) : s === "closed" ? (
                    <X />
                  ) : s === "in_progress" ? (
                    <Pause />
                  ) : null}
                  {s.replace("_", " ")}
                </Button>
              ))}
            </div>
            <Separator className="my-3" />
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Priority
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["low", "normal", "high", "urgent"] as TicketPriority[]).map(
                (p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={ticket.priority === p ? "default" : "outline"}
                    disabled={busy !== null}
                    onClick={() =>
                      withBusy(
                        "priority",
                        () => setTicketPriority(ticket.id, p),
                        `Priority set to ${p}.`,
                      )
                    }
                  >
                    {p}
                  </Button>
                ),
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
