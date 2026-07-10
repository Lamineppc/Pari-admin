import { UsersRound } from "lucide-react";
import { PlaceholderSection } from "@/components/placeholder-section";

export default function GroupsPage() {
  return (
    <PlaceholderSection
      title="Groups"
      description="All tontines on the platform, with escalation intervention."
      icon={UsersRound}
      nextStep="List, filter, and act on flagged groups (promote manager, take over, autopilot, cancel + refund)."
    />
  );
}
