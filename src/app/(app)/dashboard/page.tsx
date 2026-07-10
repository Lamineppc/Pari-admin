"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Store, Users, UsersRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeGroups, type Group } from "@/lib/groups";
import { subscribeUsers, type PlatformUser } from "@/lib/users";
import { subscribeStores, type Store as StoreDoc } from "@/lib/stores";

export default function DashboardPage() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [stores, setStores] = useState<StoreDoc[] | null>(null);

  useEffect(() => {
    const unsubG = subscribeGroups(setGroups, () => setGroups([]));
    const unsubU = subscribeUsers(setUsers, () => setUsers([]));
    const unsubS = subscribeStores(setStores, () => setStores([]));
    return () => {
      unsubG();
      unsubU();
      unsubS();
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
  const pendingStores = stores?.filter((s) => s.status === "pending").length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform overview. Live totals from Firestore.
        </p>
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
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  tone,
  description,
  highlight = false,
}: {
  title: string;
  value: number | undefined;
  icon: typeof AlertTriangle;
  tone: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-red-300 dark:border-red-800" : undefined}>
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
}
