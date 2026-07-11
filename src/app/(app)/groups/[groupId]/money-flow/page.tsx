"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  RefreshCw,
  Wallet as WalletIcon,
  AlertTriangle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { computeMoneyFlow, type MoneyFlowReport } from "@/lib/money-flow";

export default function MoneyFlowPage() {
  const params = useParams<{ groupId: string }>();
  const router = useRouter();
  const [report, setReport] = useState<MoneyFlowReport | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!params?.groupId) return;
    setLoading(true);
    try {
      const r = await computeMoneyFlow(params.groupId);
      setReport(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.groupId]);

  function exportCsv() {
    if (!report) return;
    const cols = ["userId", "userName", "role", "position", "kicked", "contributed", "paidPenalty", "receivedPayout", "receivedRefund", "net"];
    const rows = report.members.map((m) => [
      m.userId,
      m.userName,
      m.role,
      m.position ?? "",
      String(m.kicked),
      m.contributed,
      m.paidPenalty,
      m.receivedPayout,
      m.receivedRefund,
      m.net,
    ]);
    const csv = [cols, ...rows]
      .map((r) =>
        r
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `money_flow_${report.groupName.replace(/\s+/g, "_")}_${report.computedAt.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !report) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!report) return null;

  const fmt = (n: number) => `${report.currency} ${n.toLocaleString()}`;
  const reconciled =
    report.potDiscrepancy !== null && Math.abs(report.potDiscrepancy) < 0.5;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/groups?selected=${report.groupId}`)}
          >
            <ArrowLeft /> Back to group
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Money flow — {report.groupName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Computed from {report.totals.contributions.count + report.totals.payouts.count + report.totals.refunds.count + report.totals.penalties.count} ledger entries at{" "}
              {report.computedAt.toLocaleString()}.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download /> Export CSV
          </Button>
        </div>
      </header>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Contributions in"
          value={fmt(report.totals.contributions.amount)}
          sub={`${report.totals.contributions.count} entries`}
          tone="green"
          icon={<ArrowDown className="h-4 w-4" />}
        />
        <SummaryCard
          label="Payouts out"
          value={fmt(report.totals.payouts.amount)}
          sub={`${report.totals.payouts.count} entries`}
          tone="blue"
          icon={<ArrowUp className="h-4 w-4" />}
        />
        <SummaryCard
          label="Refunds out"
          value={fmt(report.totals.refunds.amount)}
          sub={`${report.totals.refunds.count} entries`}
          tone="amber"
          icon={<ArrowUp className="h-4 w-4" />}
        />
        <SummaryCard
          label="Penalties in"
          value={fmt(report.totals.penalties.amount)}
          sub={`${report.totals.penalties.count} entries`}
          tone="red"
          icon={<ArrowDown className="h-4 w-4" />}
        />
      </div>

      {/* Reconciliation */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Computed pot balance
          </div>
          <div className="mt-1 flex items-center gap-2">
            <WalletIcon className="h-4 w-4 text-muted-foreground" />
            <span className="tabular-nums text-lg font-semibold">
              {fmt(report.computedPotBalance)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            in + penalties − out − refunds
          </div>
        </div>
        <div className="rounded-md border p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Actual pot balance
          </div>
          <div className="mt-1 flex items-center gap-2">
            <WalletIcon className="h-4 w-4 text-muted-foreground" />
            <span className="tabular-nums text-lg font-semibold">
              {report.actualPotBalance === null
                ? "—"
                : fmt(report.actualPotBalance)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {report.moneyProvider === "mock"
              ? "from mock pot wallet"
              : "real-money check needs PR 6b–d"}
          </div>
        </div>
        <div
          className={
            report.potDiscrepancy === null
              ? "rounded-md border p-4"
              : reconciled
                ? "rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40"
                : "rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40"
          }
        >
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Reconciliation
          </div>
          <div className="mt-1 flex items-center gap-2">
            {report.potDiscrepancy === null ? (
              <span className="text-sm text-muted-foreground">
                Not checked (real-money)
              </span>
            ) : reconciled ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  Ledger and wallet agree
                </span>
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  Off by {fmt(Math.abs(report.potDiscrepancy))}
                </span>
              </>
            )}
          </div>
          {report.potDiscrepancy !== null && !reconciled && (
            <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">
              Investigate — ledger integrity is broken.
            </div>
          )}
        </div>
      </div>

      {/* Per-member */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Per member</h2>
        <p className="text-xs text-muted-foreground">
          Net = received payouts + refunds − contributions − penalties. A
          fully-completed rotation lands every non-kicked member near zero.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Pos</TableHead>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Contributed</TableHead>
                <TableHead className="text-right">Penalty</TableHead>
                <TableHead className="text-right">Payouts</TableHead>
                <TableHead className="text-right">Refund</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.members.map((m) => (
                <TableRow key={m.userId} className={m.kicked ? "opacity-60" : ""}>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    #{m.position ?? "?"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1">
                      {m.userName}
                      {m.kicked && (
                        <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                          kicked
                        </Badge>
                      )}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground" title={m.userId}>
                      {m.userId}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                      {m.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(m.contributed)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(m.paidPenalty)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(m.receivedPayout)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(m.receivedRefund)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold">
                    <span
                      className={
                        m.net > 0
                          ? "text-emerald-700 dark:text-emerald-300"
                          : m.net < 0
                            ? "text-red-700 dark:text-red-300"
                            : "text-muted-foreground"
                      }
                    >
                      {m.net > 0 ? "+" : ""}
                      {fmt(m.net)}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Per-cycle */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Per cycle</h2>
        <p className="text-xs text-muted-foreground">
          Running pot balance after each cycle&apos;s ledger entries applied.
          A healthy Secured rotation ends near zero on Terminal.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Cycle</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Penalty in</TableHead>
                <TableHead className="text-right">Payouts out</TableHead>
                <TableHead className="text-right">Refunds out</TableHead>
                <TableHead className="text-right">Pot after</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.cycles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-16 text-center text-sm text-muted-foreground">
                    No ledger entries yet.
                  </TableCell>
                </TableRow>
              )}
              {report.cycles.map((c) => (
                <TableRow key={c.cycleNumber}>
                  <TableCell className="tabular-nums">{c.cycleNumber}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.phase}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(c.contributionsIn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(c.penaltiesIn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(c.payoutsOut)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {fmt(c.refundsOut)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-semibold">
                    {fmt(c.potBalanceAfter)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "green" | "blue" | "amber" | "red";
  icon: React.ReactNode;
}) {
  const toneClass = {
    green: "text-emerald-600",
    blue: "text-blue-600",
    amber: "text-amber-600",
    red: "text-red-600",
  }[tone];
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <span className={toneClass}>{icon}</span>
      </div>
      <div className="mt-1 tabular-nums text-xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}
