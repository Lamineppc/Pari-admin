"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PauseCircle, PlayCircle, ShieldCheck, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { EscalationBadge } from "@/components/escalation-badge";
import {
  clearAdminEscalation,
  securedPhase,
  setGroupStatus,
  transferOwnershipToManager,
  type Group,
} from "@/lib/groups";

const PHASE_LABELS: Record<string, string> = {
  notStarted: "Not started",
  collateral: "Collateral (Phase 1)",
  distribution: "Distribution (Phase 2)",
  closed: "Closed",
};

function fmtCurrency(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString()}`;
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function GroupDetailSheet({
  group,
  onOpenChange,
}: {
  group: Group | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState<"promote" | "status" | "clear" | null>(null);

  if (!group) return null;

  const isActive = group.status === "active";
  const phase = securedPhase(group);

  async function run(kind: "promote" | "status" | "clear", fn: () => Promise<void>, ok: string) {
    setBusy(kind);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet open={!!group} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {group.name}
            {group.adminEscalationFlag && <EscalationBadge flag={group.adminEscalationFlag} />}
          </SheetTitle>
          <SheetDescription>
            {group.type === "secured" ? "Secured tontine" : "Traditional tontine"} — {group.description || "no description"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Field label="Status" value={isActive ? "Active" : "Inactive"} />
            <Field label="Members" value={String(group.memberCount)} />
            <Field label="Contribution" value={fmtCurrency(group.amount, group.currency)} />
            <Field label="Frequency" value={group.frequency} />
            {group.type === "secured" && (
              <>
                <Field label="Phase" value={PHASE_LABELS[phase] ?? phase} />
                <Field
                  label="Cycle"
                  value={group.currentCycle ? `${group.currentCycle} / ${group.memberCount}` : "—"}
                />
              </>
            )}
            <Field label="Created" value={fmtDate(group.createdAt)} />
            <Field label="Admin uid" value={group.createdBy} mono />
          </div>

          {group.adminEscalationFlag && (
            <>
              <Separator />
              <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
                <div className="font-medium text-red-800 dark:text-red-200">Escalation raised</div>
                <div className="text-red-700 dark:text-red-300">
                  {group.adminEscalationReason ?? "No reason recorded."}
                </div>
                <div className="text-xs text-red-600/80 dark:text-red-400/80">
                  Flagged {fmtDate(group.adminEscalationFlaggedAt)}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Super-admin actions
            </div>
            {group.adminEscalationFlag === "admin_default" && (
              <Button
                variant="default"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "promote",
                    () => transferOwnershipToManager(group.id),
                    "Manager promoted to admin.",
                  )
                }
              >
                <ShieldCheck /> Promote manager to admin
              </Button>
            )}
            {group.adminEscalationFlag && (
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  run("clear", () => clearAdminEscalation(group.id), "Escalation flag cleared.")
                }
              >
                <X /> Dismiss escalation (false positive)
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "status",
                  () => setGroupStatus(group.id, isActive ? "inactive" : "active"),
                  isActive ? "Group deactivated." : "Group reactivated.",
                )
              }
            >
              {isActive ? <PauseCircle /> : <PlayCircle />}
              {isActive ? "Deactivate group" : "Reactivate group"}
            </Button>
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
