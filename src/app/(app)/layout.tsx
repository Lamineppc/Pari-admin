import Image from "next/image";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export const metadata: Metadata = {
  icons: {
    icon: "/pari-icon.png",
    shortcut: "/pari-icon.png",
    apple: "/pari-icon.png",
  },
};
import { AppSidebar } from "@/components/app-sidebar";
import { UserMenu } from "@/components/user-menu";
import { AuthGuard } from "@/components/auth-guard";
import { Separator } from "@/components/ui/separator";
import { GlobalSearch } from "@/components/global-search";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Image
              src="/pari-icon.png"
              alt="Pari"
              width={64}
              height={64}
              priority
              className="ml-4 h-5 w-5"
            />
            <Separator orientation="vertical" className="mx-2 h-4" />
            <GlobalSearch />
            <UserMenu />
          </header>
          <main className="flex-1 p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
