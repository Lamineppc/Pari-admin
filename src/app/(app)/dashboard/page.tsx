import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, UsersRound, Users, Store } from "lucide-react";

const cards = [
  {
    title: "Escalations",
    description: "Groups flagged for super-admin intervention.",
    icon: AlertTriangle,
    tone: "text-red-600",
  },
  {
    title: "Active groups",
    description: "Tontines currently running across the platform.",
    icon: UsersRound,
    tone: "text-blue-600",
  },
  {
    title: "Registered users",
    description: "Total accounts, including inactive ones.",
    icon: Users,
    tone: "text-emerald-600",
  },
  {
    title: "Store applications",
    description: "Pending marketplace vendor requests.",
    icon: Store,
    tone: "text-amber-600",
  },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Platform overview. Cards will populate as sections are wired up.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
              <c.icon className={`h-4 w-4 ${c.tone}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold text-muted-foreground">—</div>
              <CardDescription className="mt-1">{c.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
