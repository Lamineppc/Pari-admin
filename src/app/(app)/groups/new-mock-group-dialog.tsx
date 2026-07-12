"use client";

import { useState } from "react";
import { Beaker, Plus } from "lucide-react";
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
import { createMockGroup } from "@/lib/mock-groups";

export function NewMockGroupDialog({
  onCreated,
}: {
  onCreated?: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Simulation");
  const [memberCount, setMemberCount] = useState("4");
  const [amount, setAmount] = useState("20000");
  const [startingBalance, setStartingBalance] = useState("");
  const [penaltyPerMissedCycle, setPenaltyPerMissedCycle] = useState("5000");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createMockGroup({
        name,
        memberCount: Number(memberCount),
        amount: Number(amount),
        startingBalance: startingBalance ? Number(startingBalance) : undefined,
        penaltyPerMissedCycle: penaltyPerMissedCycle
          ? Number(penaltyPerMissedCycle)
          : 0,
      });
      toast.success(
        `Created "${name}" with ${result.memberUids.length} test members, each seeded with ${result.startingBalance.toLocaleString()} CFA.`,
      );
      setOpen(false);
      onCreated?.(result.groupId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus /> New mock group
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Beaker className="h-4 w-4 text-purple-600" />
            New mock group
          </DialogTitle>
          <DialogDescription>
            Creates a Secured group with the given number of test members,
            positions pre-locked, and every wallet seeded with mock balance.
            Ready to run through the simulator on the group detail sheet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mock-name">Name</Label>
            <Input
              id="mock-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="mock-members">Members</Label>
              <Input
                id="mock-members"
                type="number"
                min="2"
                max="20"
                step="1"
                value={memberCount}
                onChange={(e) => setMemberCount(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mock-amount">Contribution (CFA)</Label>
              <Input
                id="mock-amount"
                type="number"
                min="0"
                step="1000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mock-balance">
              Starting balance per member (optional)
            </Label>
            <Input
              id="mock-balance"
              type="number"
              min="0"
              step="1000"
              placeholder={`Default: contribution × members + one buffer`}
              value={startingBalance}
              onChange={(e) => setStartingBalance(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mock-penalty">
              Penalty per missed cycle (CFA)
            </Label>
            <Input
              id="mock-penalty"
              type="number"
              min="0"
              step="500"
              placeholder="0 = no penalty"
              value={penaltyPerMissedCycle}
              onChange={(e) => setPenaltyPerMissedCycle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Deducted from a defaulter&apos;s Terminal payout, swept to the
              Pari platform wallet. Applied when using &quot;Demote admin&quot; or on any
              member who missed contributions.
            </p>
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
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
