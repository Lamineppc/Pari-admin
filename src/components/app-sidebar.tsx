"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  FileText,
  Inbox,
  LayoutDashboard,
  Package,
  Users,
  UsersRound,
  Store,
  UserX,
  Wrench,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const platformNav = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Escalations", href: "/escalations", icon: AlertTriangle },
  { title: "Groups", href: "/groups", icon: UsersRound },
  { title: "Users", href: "/users", icon: Users },
  { title: "Store applications", href: "/store-applications", icon: Store },
  { title: "Orders", href: "/orders", icon: Package },
];

const opsNav = [
  { title: "Support", href: "/support", icon: Inbox },
  { title: "Notifications", href: "/notifications", icon: Bell },
  { title: "Kicks + refunds", href: "/kicks", icon: UserX },
  { title: "Audit log", href: "/audit-log", icon: FileText },
  { title: "Cycle correction", href: "/cycle-correction", icon: Wrench },
];

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:hidden"
          aria-label="Pari"
        >
          <Image
            src="/pari-logo.png"
            alt="Pari"
            width={220}
            height={88}
            priority
            className="h-8 w-auto"
          />
          <span className="text-xs text-muted-foreground">Super-admin</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformNav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      className="data-active:bg-primary/10 data-active:text-primary data-active:hover:bg-primary/15 data-active:hover:text-primary"
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {opsNav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      className="data-active:bg-primary/10 data-active:text-primary data-active:hover:bg-primary/15 data-active:hover:text-primary"
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
