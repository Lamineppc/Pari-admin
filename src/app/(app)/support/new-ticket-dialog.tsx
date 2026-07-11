"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createTicket,
  type TicketCategory,
  type TicketPriority,
} from "@/lib/support";

export function NewTicketDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [groupId, setGroupId] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await createTicket({
        userId,
        userName,
        userEmail,
        subject,
        body,
        category,
        priority,
        ...(groupId ? { groupId } : {}),
      });
      toast.success("Ticket created.");
      setOpen(false);
      setUserId("");
      setUserName("");
      setUserEmail("");
      setSubject("");
      setBody("");
      setCategory("other");
      setPriority("normal");
      setGroupId("");
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
            <Plus /> New ticket
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create ticket on behalf of user</DialogTitle>
          <DialogDescription>
            For email / phone intake before the mobile app grows a
            &quot;Contact support&quot; flow.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="uid">User uid</Label>
            <Input id="uid" value={userId} onChange={(e) => setUserId(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="uname">User name</Label>
              <Input id="uname" value={userName} onChange={(e) => setUserName(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="uemail">User email</Label>
              <Input id="uemail" type="email" value={userEmail} onChange={(e) => setUserEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={4} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Category</Label>
              <div className="flex flex-wrap gap-1">
                {(["money", "group", "store", "account", "other"] as TicketCategory[]).map((c) => (
                  <Button key={c} type="button" size="sm" variant={category === c ? "default" : "outline"} onClick={() => setCategory(c)}>
                    {c}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <div className="flex flex-wrap gap-1">
                {(["low", "normal", "high", "urgent"] as TicketPriority[]).map((p) => (
                  <Button key={p} type="button" size="sm" variant={priority === p ? "default" : "outline"} onClick={() => setPriority(p)}>
                    {p}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="gid">Related group id (optional)</Label>
            <Input id="gid" value={groupId} onChange={(e) => setGroupId(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
