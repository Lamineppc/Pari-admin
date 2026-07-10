import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export function PlaceholderSection({
  title,
  description,
  icon: Icon,
  nextStep,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  nextStep: string;
}) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming up next</CardTitle>
          <CardDescription>{nextStep}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This section will be wired to Firestore in a follow-up commit.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
