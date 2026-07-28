"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { subscribeStore, type Store } from "@/lib/stores";
import { StoreDetailBody } from "../store-detail-body";

export default function StoreDetailPage() {
  const params = useParams<{ storeId: string }>();
  const router = useRouter();
  const storeId = params?.storeId ?? null;
  const [store, setStore] = useState<Store | null | undefined>(undefined);

  useEffect(() => {
    if (!storeId) return;
    const unsub = subscribeStore(
      storeId,
      (s) => setStore(s),
      () => setStore(null),
    );
    return unsub;
  }, [storeId]);

  if (store === undefined) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (store === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/store-applications")}>
          <ArrowLeft className="h-4 w-4" /> Back to stores
        </Button>
        <p className="text-sm text-muted-foreground">
          Store not found (id: {storeId}). It may have been deleted.
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
        onClick={() => router.push("/store-applications")}
      >
        <ArrowLeft className="h-4 w-4" /> Back to stores
      </Button>
      <StoreDetailBody store={store} />
    </div>
  );
}
