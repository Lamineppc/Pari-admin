"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COUNTRIES, flagEmoji } from "@/lib/countries";
import { cn } from "@/lib/utils";

/** Searchable ISO-2 country dropdown. `value` and `onChange` speak ISO-2
 *  (e.g. "ML"). Rendered as a click-to-open panel to avoid dragging in a
 *  full combobox lib. */
export function CountrySelect({
  value,
  onChange,
  placeholder = "Select country",
  className,
}: {
  value: string | null;
  onChange: (iso: string, name: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.iso.toLowerCase().includes(needle),
    );
  }, [q]);

  const selected = value ? COUNTRIES.find((c) => c.iso === value) : null;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm hover:bg-muted/50"
      >
        {selected ? (
          <>
            <span className="text-base leading-none">
              {flagEmoji(selected.iso)}
            </span>
            <span className="flex-1 truncate text-left">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-muted-foreground">
            {placeholder}
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute z-50 mt-1 w-full min-w-[16rem] rounded-md border bg-background shadow-lg">
            <div className="border-b p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No match.
                </div>
              )}
              {filtered.map((c) => (
                <button
                  key={c.iso}
                  type="button"
                  onClick={() => {
                    onChange(c.iso, c.name);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted",
                    value === c.iso && "bg-muted",
                  )}
                >
                  <span className="text-base leading-none">
                    {flagEmoji(c.iso)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.iso}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
