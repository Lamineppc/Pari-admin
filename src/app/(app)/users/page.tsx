"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Users, Search } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeUsers, type PlatformUser } from "@/lib/users";
import { useAuth } from "@/lib/auth-context";
import { UserDetailSheet } from "./user-detail-sheet";

export default function UsersPage() {
  const { user: authUser } = useAuth();
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const unsub = subscribeUsers(setUsers, (e) => {
      toast.error(e.message);
      setUsers([]);
    });
    return unsub;
  }, []);

  // Deep-link support: global search sends users here with ?selected=<uid>.
  useEffect(() => {
    const sel = searchParams.get("selected");
    if (sel) setSelectedId(sel);
  }, [searchParams]);

  const filtered = useMemo(() => {
    if (!users) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.uid.toLowerCase().includes(needle) ||
        (u.username?.toLowerCase().includes(needle) ?? false),
    );
  }, [users, q]);

  const selected = users?.find((u) => u.uid === selectedId) ?? null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
            <p className="text-sm text-muted-foreground">
              Every registered account. Click a row to view details and manage access.
            </p>
          </div>
        </div>
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, username, or uid…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
      </header>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered === null && <LoadingRows />}
            {filtered !== null && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  {q ? "No users match your search." : "No users yet."}
                </TableCell>
              </TableRow>
            )}
            {filtered?.map((u) => {
              const location = [u.city, u.state, u.country].filter(Boolean).join(", ");
              return (
                <TableRow
                  key={u.uid}
                  onClick={() => setSelectedId(u.uid)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">{u.name || "(no name)"}</TableCell>
                  <TableCell className="truncate text-sm text-muted-foreground" title={u.email}>
                    {u.email || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.username ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {location || "—"}
                  </TableCell>
                  <TableCell>
                    {u.banType === "hard" ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                        Hard ban
                      </Badge>
                    ) : u.banType === "soft" ? (
                      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        Soft ban
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Active</Badge>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <UserDetailSheet
        user={selected}
        currentUid={authUser?.uid ?? null}
        onOpenChange={(o) => !o && setSelectedId(null)}
      />
    </div>
  );
}

function LoadingRows() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <TableRow key={i}>
          <TableCell colSpan={5}>
            <Skeleton className="h-6 w-full" />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
