"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { Skeleton } from "@/components/ui/skeleton";

export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading, isSuperAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!isSuperAdmin) router.replace("/access-denied");
  }, [loading, user, isSuperAdmin, router]);

  if (loading || !user || !isSuperAdmin) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-3 p-8">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-56" />
      </div>
    );
  }

  return <>{children}</>;
}
