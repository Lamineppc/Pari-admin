"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ShieldPlus, User as UserIcon, Store as StoreIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EscalationBadge } from "@/components/escalation-badge";
import {
  isMockMoneyGroup,
  phaseLabelForCycle,
  subscribeGroups,
  type Group,
} from "@/lib/groups";
import { subscribeUsers, type PlatformUser } from "@/lib/users";
import { subscribeStores, type Store } from "@/lib/stores";
import { StoreDetailSheet } from "../store-applications/store-detail-sheet";

type Tab = "groups" | "users" | "stores";
type SortKey = "age" | "money" | "size";

function fmtAge(d: Date | null): string {
  if (!d) return "—";
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function moneyAtRisk(g: Group): number {
  return g.amount * g.memberCount * Math.max(g.currentCycle ?? 0, 1);
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="h-3 w-3" />
      {kind.replace(/_/g, " ")}
    </span>
  );
}

export default function EscalationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("groups");

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [stores, setStores] = useState<Store[] | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("age");
  const [openStore, setOpenStore] = useState<Store | null>(null);

  useEffect(() => {
    const u1 = subscribeGroups(setGroups, (e) => {
      toast.error(e.message);
      setGroups([]);
    });
    const u2 = subscribeUsers(setUsers, (e) => {
      toast.error(e.message);
      setUsers([]);
    });
    const u3 = subscribeStores(setStores, (e) => {
      toast.error(e.message);
      setStores([]);
    });
    return () => {
      u1();
      u2();
      u3();
    };
  }, []);

  const escalatedGroups = useMemo(() => {
    if (!groups) return null;
    const filtered = groups.filter(
      (g) => g.adminEscalationFlag !== null || g.caretakerBy !== null,
    );
    filtered.sort((a, b) => {
      if (sortBy === "age") {
        const at = a.adminEscalationFlaggedAt?.getTime() ?? 0;
        const bt = b.adminEscalationFlaggedAt?.getTime() ?? 0;
        return at - bt;
      }
      if (sortBy === "money") return moneyAtRisk(b) - moneyAtRisk(a);
      return b.memberCount - a.memberCount;
    });
    return filtered;
  }, [groups, sortBy]);

  const escalatedUsers = useMemo(() => {
    if (!users) return null;
    return users
      .filter((u) => u.escalationFlag !== null)
      .sort((a, b) => {
        const at = a.escalationFlaggedAt?.getTime() ?? 0;
        const bt = b.escalationFlaggedAt?.getTime() ?? 0;
        return at - bt;
      });
  }, [users]);

  const escalatedStores = useMemo(() => {
    if (!stores) return null;
    return stores
      .filter((s) => s.escalationFlag !== null)
      .sort((a, b) => {
        const at = a.escalationFlaggedAt?.getTime() ?? 0;
        const bt = b.escalationFlaggedAt?.getTime() ?? 0;
        return at - bt;
      });
  }, [stores]);

  const activeGroupFlags =
    escalatedGroups?.filter((g) => g.adminEscalationFlag !== null).length ?? 0;
  const caretakers =
    escalatedGroups?.filter((g) => g.caretakerBy !== null).length ?? 0;
  const activeUserFlags = escalatedUsers?.length ?? 0;
  const activeStoreFlags = escalatedStores?.length ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Escalations</h1>
            <p className="text-sm text-muted-foreground">
              Everything needing super-admin attention — flagged groups,
              users, and stores. Click any row for the intervention actions.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 pt-2">
          <StatCard label="Group flags" value={activeGroupFlags} tone="red" />
          <StatCard label="Under caretaker" value={caretakers} tone="blue" />
          <StatCard label="User flags" value={activeUserFlags} tone="amber" />
          <StatCard label="Store flags" value={activeStoreFlags} tone="amber" />
        </div>
      </header>

      <div className="flex items-center gap-1 border-b">
        <TabButton
          active={tab === "groups"}
          onClick={() => setTab("groups")}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Groups"
          count={(activeGroupFlags + caretakers) || 0}
        />
        <TabButton
          active={tab === "users"}
          onClick={() => setTab("users")}
          icon={<UserIcon className="h-3.5 w-3.5" />}
          label="Users"
          count={activeUserFlags}
        />
        <TabButton
          active={tab === "stores"}
          onClick={() => setTab("stores")}
          icon={<StoreIcon className="h-3.5 w-3.5" />}
          label="Stores"
          count={activeStoreFlags}
        />
      </div>

      {tab === "groups" && (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Sort:</span>
            <SortToggle current={sortBy} onSet={setSortBy} value="age" label="Oldest first" />
            <SortToggle current={sortBy} onSet={setSortBy} value="money" label="Money at risk" />
            <SortToggle current={sortBy} onSet={setSortBy} value="size" label="Group size" />
          </div>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Flag</TableHead>
                  <TableHead>Phase / cycle</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead className="text-right">Est. money</TableHead>
                  <TableHead>Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {escalatedGroups === null && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {escalatedGroups !== null && escalatedGroups.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-sm text-muted-foreground">
                      No flagged groups and no caretakers.
                    </TableCell>
                  </TableRow>
                )}
                {escalatedGroups?.map((g) => {
                  const current = g.currentCycle ?? 0;
                  return (
                    <TableRow
                      key={g.id}
                      onClick={() => router.push(`/groups/${g.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <span>{g.name}</span>
                          {isMockMoneyGroup(g) && (
                            <span className="rounded border border-purple-200 bg-purple-50 px-1 py-0.5 text-[9px] font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-200">
                              sim
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {g.adminEscalationFlag ? (
                          <EscalationBadge flag={g.adminEscalationFlag} />
                        ) : g.caretakerBy ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                            <ShieldPlus className="h-3 w-3" /> Caretaker
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {phaseLabelForCycle(g, current)} · {current}/{g.memberCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{g.memberCount}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {g.currency} {moneyAtRisk(g).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {fmtAge(g.adminEscalationFlaggedAt)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {tab === "users" && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escalatedUsers === null && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {escalatedUsers !== null && escalatedUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    No flagged users.
                  </TableCell>
                </TableRow>
              )}
              {escalatedUsers?.map((u) => (
                <TableRow
                  key={u.uid}
                  onClick={() => router.push(`/users?uid=${u.uid}`)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{u.name || "(no name)"}</span>
                      <span className="text-[11px] text-muted-foreground">{u.email}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.escalationFlag && <KindBadge kind={u.escalationFlag} />}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {u.escalationReason || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtAge(u.escalationFlaggedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === "stores" && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Store</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {escalatedStores === null && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {escalatedStores !== null && escalatedStores.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-sm text-muted-foreground">
                    No flagged stores.
                  </TableCell>
                </TableRow>
              )}
              {escalatedStores?.map((s) => (
                <TableRow
                  key={s.id}
                  onClick={() => setOpenStore(s)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{s.storeName || "(no name)"}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {s.ownerName || s.ownerId}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.escalationFlag && <KindBadge kind={s.escalationFlag} />}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                    {s.escalationReason || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtAge(s.escalationFlaggedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <StoreDetailSheet
        store={openStore}
        onOpenChange={(open) => !open && setOpenStore(null)}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "blue" | "amber";
}) {
  const cls =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      : tone === "blue"
        ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200"
        : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return (
    <div className={`flex flex-col rounded-md border p-3 min-w-32 ${cls}`}>
      <span className="text-xs uppercase tracking-wide opacity-75">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "-mb-px flex items-center gap-2 border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary"
          : "-mb-px flex items-center gap-2 border-b-2 border-transparent px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
      }
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </button>
  );
}

function SortToggle({
  current,
  value,
  label,
  onSet,
}: {
  current: SortKey;
  value: SortKey;
  label: string;
  onSet: (v: SortKey) => void;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onSet(value)}
      className={
        active
          ? "rounded-md bg-primary/10 px-2 py-1 font-medium text-primary"
          : "rounded-md px-2 py-1 hover:bg-muted"
      }
    >
      {label}
    </button>
  );
}
