"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Beaker, Flag, History, RefreshCw, ShieldOff, Sparkles, Store, Users, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeGroups, type Group } from "@/lib/groups";
import { subscribeUsers, type PlatformUser } from "@/lib/users";
import { subscribeStores, type Store as StoreDoc } from "@/lib/stores";
import { subscribeAuditLog, type AuditEntry } from "@/lib/audit";
import { healAllGroups } from "@/lib/heal";

export default function DashboardPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [stores, setStores] = useState<StoreDoc[] | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    const unsubG = subscribeGroups(setGroups, () => setGroups([]));
    const unsubU = subscribeUsers(setUsers, () => setUsers([]));
    const unsubS = subscribeStores(setStores, () => setStores([]));
    const unsubA = subscribeAuditLog(
      setAudit,
      { max: 15 },
      () => setAudit([]),
    );
    return () => {
      unsubG();
      unsubU();
      unsubS();
      unsubA();
    };
  }, []);

  const groupStats = useMemo(() => {
    if (!groups) return null;
    return {
      escalations: groups.filter((g) => g.adminEscalationFlag !== null).length,
      active: groups.filter((g) => g.status === "active").length,
    };
  }, [groups]);
  const userCount = users?.length;
  const userStats = useMemo(() => {
    if (!users) return null;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      escalated: users.filter((u) => u.escalationFlag !== null).length,
      banned: users.filter((u) => u.banType !== null).length,
      test: users.filter((u) => u.isTestAccount).length,
      new24h: users.filter(
        (u) => u.createdAt && now - u.createdAt.getTime() < dayMs,
      ).length,
    };
  }, [users]);

  const recentSignups = useMemo(() => {
    if (!users) return null;
    return [...users]
      .filter((u) => u.createdAt)
      .sort(
        (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      )
      .slice(0, 5);
  }, [users]);
  const pendingStores = stores?.filter((s) => s.status === "pending").length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Platform overview. Live totals from Firestore.
          </p>
        </div>
        <HealAllButton />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Escalations"
          value={groupStats?.escalations}
          icon={AlertTriangle}
          tone="text-red-600"
          description="Groups flagged for super-admin intervention."
          highlight={(groupStats?.escalations ?? 0) > 0}
        />
        <StatCard
          title="Active groups"
          value={groupStats?.active}
          icon={UsersRound}
          tone="text-blue-600"
          description="Tontines currently running across the platform."
        />
        <StatCard
          title="Registered users"
          value={userCount}
          icon={Users}
          tone="text-emerald-600"
          description="Total accounts, including banned ones."
        />
        <StatCard
          title="Store applications"
          value={pendingStores}
          icon={Store}
          tone="text-amber-600"
          description="Marketplace vendors awaiting review."
          highlight={(pendingStores ?? 0) > 0}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="New in 24h"
          value={userStats?.new24h}
          icon={Sparkles}
          tone="text-emerald-600"
          description="Signups landed in the last 24 hours."
        />
        <StatCard
          title="Escalated users"
          value={userStats?.escalated}
          icon={Flag}
          tone="text-amber-600"
          description="Users flagged for review (spam, fraud, complaint)."
          highlight={(userStats?.escalated ?? 0) > 0}
          href="/users?filter=escalated"
        />
        <StatCard
          title="Banned users"
          value={userStats?.banned}
          icon={ShieldOff}
          tone="text-red-600"
          description="Accounts with soft or hard ban currently applied."
          href="/users?filter=banned"
        />
        <StatCard
          title="Test accounts"
          value={userStats?.test}
          icon={Beaker}
          tone="text-purple-600"
          description="Simulation-only accounts (mock money universe)."
          href="/users?filter=test"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <RecentActivityCard entries={audit} />
        <RecentSignupsCard users={recentSignups} />
      </div>
    </div>
  );
}

function RecentSignupsCard({
  users,
}: {
  users: PlatformUser[] | null;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Recent signups</CardTitle>
        <Sparkles className="h-4 w-4 text-emerald-600" />
      </CardHeader>
      <CardContent>
        {users === null && <Skeleton className="h-24 w-full" />}
        {users && users.length === 0 && (
          <CardDescription>No signups recorded yet.</CardDescription>
        )}
        {users && users.length > 0 && (
          <div className="flex flex-col divide-y">
            {users.map((u) => (
              <Link
                key={u.uid}
                href={`/users/${u.uid}`}
                className="flex flex-wrap items-center gap-2 rounded-md px-1 py-2 text-xs hover:bg-muted/40"
              >
                <span className="flex-1 truncate font-medium">
                  {u.name || u.email || u.uid.slice(0, 10)}
                </span>
                {u.isTestAccount && (
                  <span className="rounded bg-purple-100 px-1 text-[10px] text-purple-800 dark:bg-purple-950 dark:text-purple-200">
                    test
                  </span>
                )}
                {u.createdAt && (
                  <span className="text-[10px] text-muted-foreground">
                    {u.createdAt.toLocaleString(undefined, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivityCard({ entries }: { entries: AuditEntry[] | null }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
        <History className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {entries === null && <Skeleton className="h-24 w-full" />}
        {entries && entries.length === 0 && (
          <CardDescription>
            Nothing recorded yet. Super-admin actions land here as they happen.
          </CardDescription>
        )}
        {entries && entries.length > 0 && (
          <div className="flex flex-col divide-y">
            {entries.map((e) => {
              const href =
                e.targetType === "user"
                  ? `/users/${e.targetId}`
                  : e.targetType === "group"
                    ? `/groups/${e.targetId}`
                    : null;
              const inner = (
                <div className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <span className="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase">
                    {e.action.replace(/_/g, " ")}
                  </span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {e.targetType}
                    {e.targetId ? ` · ${e.targetId.slice(0, 10)}…` : ""}
                    {e.reason ? ` — ${e.reason}` : ""}
                  </span>
                  {e.createdAt && (
                    <span className="text-[10px] text-muted-foreground">
                      {e.createdAt.toLocaleString(undefined, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  )}
                </div>
              );
              return href ? (
                <Link
                  key={e.id}
                  href={href}
                  className="rounded-md px-1 hover:bg-muted/40"
                >
                  {inner}
                </Link>
              ) : (
                <div key={e.id} className="px-1">
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone,
  description,
  highlight = false,
  href,
}: {
  title: string;
  value: number | undefined;
  icon: typeof AlertTriangle;
  tone: string;
  description: string;
  highlight?: boolean;
  href?: string;
}) {
  const inner = (
    <Card
      className={
        (highlight ? "border-red-300 dark:border-red-800 " : "") +
        (href ? "transition hover:bg-muted/40" : "")
      }
    >
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${tone}`} />
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          <Skeleton className="h-8 w-12" />
        ) : (
          <div className={`text-2xl font-semibold ${highlight ? "text-red-600" : ""}`}>
            {value}
          </div>
        )}
        <CardDescription className="mt-1">{description}</CardDescription>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function HealAllButton() {
  const [running, setRunning] = useState(false);
  async function run() {
    if (
      !window.confirm(
        "Run heal on every group? Fixes stale cycle counters, missing admin member docs, and orphan members (adds a slot for anyone without one). Safe to re-run — no-ops when nothing is drifting.",
      )
    ) {
      return;
    }
    setRunning(true);
    try {
      const r = await healAllGroups();
      const details = [
        `${r.processed} group${r.processed === 1 ? "" : "s"} scanned`,
      ];
      if (r.cycleFixed) details.push(`${r.cycleFixed} cycle fixes`);
      if (r.adminMemberCreated)
        details.push(`${r.adminMemberCreated} admin doc restores`);
      if (r.slotsCreated) details.push(`${r.slotsCreated} slots added`);
      if (r.failed) details.push(`${r.failed} failed`);
      toast.success(details.join(" · "));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Heal-all failed.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={running}
      onClick={run}
      className="h-9"
    >
      <RefreshCw className="h-4 w-4" />
      {running ? "Healing…" : "Heal all groups"}
    </Button>
  );
}
