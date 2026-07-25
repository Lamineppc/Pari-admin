import { Badge } from "@/components/ui/badge";
import type { EscalationArchiveEntry } from "@/lib/escalation-archive";

export function ArchiveList({
  title,
  entries,
}: {
  title?: string;
  entries: EscalationArchiveEntry[] | null;
}) {
  return (
    <section className="flex flex-col gap-2">
      {title && (
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
      )}
      {entries === null ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing archived yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                >
                  ⚠ {e.flag.replace(/_/g, " ")}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Dismissed {e.dismissedAt?.toLocaleString() ?? "—"}
                  {e.dismissedByEmail && ` · by ${e.dismissedByEmail}`}
                </span>
              </div>
              {e.reason?.trim() && (
                <div className="mt-2 whitespace-pre-wrap text-sm">
                  <span className="text-xs text-muted-foreground">Reason: </span>
                  {e.reason}
                </div>
              )}
              {e.dismissNote?.trim() && (
                <div className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  <span className="text-xs">Dismiss note: </span>
                  {e.dismissNote}
                </div>
              )}
              {e.flaggedAt && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Originally flagged {e.flaggedAt.toLocaleString()}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
