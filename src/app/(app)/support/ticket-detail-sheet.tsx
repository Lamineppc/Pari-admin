"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, MessageSquare, Pause, Send, User as UserIcon, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  addInternalNote,
  replyToTicket,
  setTicketPriority,
  setTicketStatus,
  type SupportTicket,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/support";

const PRIORITY_STYLES: Record<TicketPriority, string> = {
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200",
  normal: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  high: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  urgent: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  open: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  in_progress: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  closed: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
};

export function TicketDetailSheet({
  ticket,
  onOpenChange,
}: {
  ticket: SupportTicket | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"reply" | "note" | "status" | "priority" | null>(null);

  useEffect(() => {
    setReply("");
    setNote("");
  }, [ticket?.id]);

  if (!ticket) return null;

  async function withBusy<T>(kind: "reply" | "note" | "status" | "priority", fn: () => Promise<T>, ok: string) {
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

  return (
    <Sheet open={!!ticket} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {ticket.subject || "(no subject)"}
            <Badge variant="outline" className={PRIORITY_STYLES[ticket.priority]}>
              {ticket.priority}
            </Badge>
            <Badge variant="outline" className={STATUS_STYLES[ticket.status]}>
              {ticket.status.replace("_", " ")}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            From {ticket.userName || ticket.userEmail || ticket.userId} —{" "}
            {ticket.createdAt?.toLocaleString() ?? "unknown time"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          {/* User info */}
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <div className="flex flex-col">
                <span>{ticket.userName || ticket.userEmail || ticket.userId}</span>
                <span className="truncate font-mono text-[10px] text-muted-foreground" title={ticket.userId}>
                  {ticket.userId}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/users?selected=${ticket.userId}`)}
            >
              Open user <ArrowRight />
            </Button>
          </div>

          {ticket.groupId && (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">About group</span>
                <span className="truncate font-mono text-[10px]" title={ticket.groupId}>
                  {ticket.groupId}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/groups?selected=${ticket.groupId}`)}
              >
                Open group <ArrowRight />
              </Button>
            </div>
          )}

          {/* Body */}
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Body</div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.body || "(empty)"}
            </p>
          </div>

          <Separator />

          {/* Status + priority controls */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="flex flex-wrap gap-2">
              {(["open", "in_progress", "resolved", "closed"] as TicketStatus[]).map((s) => (
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
                  {s === "resolved" ? <CheckCircle2 /> : s === "closed" ? <X /> : s === "in_progress" ? <Pause /> : null}
                  {s.replace("_", " ")}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Priority</div>
            <div className="flex flex-wrap gap-2">
              {(["low", "normal", "high", "urgent"] as TicketPriority[]).map((p) => (
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
              ))}
            </div>
          </div>

          <Separator />

          {/* Reply */}
          <div className="flex flex-col gap-2">
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
              rows={4}
            />
            <Button
              variant="default"
              size="sm"
              disabled={busy !== null || reply.trim().length === 0}
              onClick={() =>
                withBusy("reply", async () => {
                  await replyToTicket(ticket.id, reply);
                  setReply("");
                }, "Reply sent to user.")
              }
            >
              <Send /> Send reply
            </Button>
            {ticket.lastReply && (
              <div className="rounded-md border bg-muted/30 p-2 text-xs">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Last reply · {ticket.lastReplyAt?.toLocaleString() ?? "—"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">{ticket.lastReply}</div>
              </div>
            )}
          </div>

          <Separator />

          {/* Internal notes */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Internal notes ({ticket.internalNotes.length})
            </div>
            {ticket.internalNotes.length > 0 && (
              <div className="flex flex-col gap-2">
                {ticket.internalNotes.map((n, i) => (
                  <div
                    key={i}
                    className="rounded-md border bg-muted/30 p-2 text-xs"
                  >
                    <div className="text-[10px] text-muted-foreground">
                      {n.authorEmail || n.authorUid.slice(0, 12)} ·{" "}
                      {n.createdAt?.toLocaleString() ?? "—"}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{n.body}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="grid gap-2">
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
                disabled={busy !== null || note.trim().length === 0}
                onClick={() =>
                  withBusy("note", async () => {
                    await addInternalNote(ticket.id, note);
                    setNote("");
                  }, "Note added.")
                }
              >
                <MessageSquare /> Add note
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
