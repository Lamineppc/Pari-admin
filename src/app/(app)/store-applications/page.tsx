import { Store } from "lucide-react";
import { PlaceholderSection } from "@/components/placeholder-section";

export default function StoreApplicationsPage() {
  return (
    <PlaceholderSection
      title="Store applications"
      description="Marketplace vendor approval queue."
      icon={Store}
      nextStep="Review pending stores, open supporting docs, approve or reject with a reason."
    />
  );
}
