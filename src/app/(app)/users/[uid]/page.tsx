"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import { subscribeUser, type PlatformUser } from "@/lib/users";
import { UserDetailBody } from "../user-detail-body";

export default function UserDetailPage() {
  const params = useParams<{ uid: string }>();
  const router = useRouter();
  const { user: authUser } = useAuth();
  const uid = params?.uid ?? null;
  const [user, setUser] = useState<PlatformUser | null | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeUser(
      uid,
      (u) => setUser(u),
      () => setUser(null),
    );
    return unsub;
  }, [uid]);

  if (user === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/users")}>
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Button>
        <p className="text-sm text-muted-foreground">
          User not found (uid: {uid}). They may have been hard-deleted or the
          link is wrong.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => router.push("/users")}
      >
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Button>
      <UserDetailBody
        user={user}
        currentUid={authUser?.uid ?? null}
        onDeleted={() => router.push("/users")}
      />
    </div>
  );
}
