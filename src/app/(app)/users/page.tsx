import { Users } from "lucide-react";
import { PlaceholderSection } from "@/components/placeholder-section";

export default function UsersPage() {
  return (
    <PlaceholderSection
      title="Users"
      description="Registered accounts across the platform."
      icon={Users}
      nextStep="Searchable user list, profile drawer, and moderation actions (ban / unban)."
    />
  );
}
