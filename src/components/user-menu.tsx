"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export function UserMenu() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  if (!user) return null;
  const initials =
    (user.email?.[0] ?? "?").toUpperCase() +
    (user.email?.split("@")[0]?.[1] ?? "").toUpperCase();

  async function handleSignOut() {
    try {
      await signOut();
      toast.success("Signed out.");
      router.replace("/login");
    } catch {
      toast.error("Could not sign out.");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm sm:inline">{user.email}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
        <span className="hidden text-sm sm:inline">Sign out</span>
      </Button>
    </div>
  );
}
