"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { COUNTRIES, dialCode, flagEmoji } from "@/lib/countries";
import { cn } from "@/lib/utils";

/** Country-code + national-number input. Emits the combined E.164 string
 *  ("+22370123456") via `onChange`. Empty national number → empty string
 *  so the caller can treat it as "no phone". */
export function PhoneInput({
  isoCountry,
  onIsoChange,
  value,
  onChange,
  placeholder = "70123456",
  className,
}: {
  isoCountry: string;
  onIsoChange: (iso: string) => void;
  /** Combined E.164 string (empty when no digits). */
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const dial = dialCode(isoCountry) ?? "";
  // National portion = whatever comes after "+<dial>" in the current value.
  const nationalDigits = useMemo(() => {
    if (!value) return "";
    const stripped = value.replace(/[^\d]/g, "");
    if (dial && stripped.startsWith(dial)) return stripped.slice(dial.length);
    return stripped;
  }, [value, dial]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const withDial = COUNTRIES.map((c) => ({
      ...c,
      dial: dialCode(c.iso),
    })).filter((c) => c.dial !== null);
    if (!needle) return withDial;
    return withDial.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.iso.toLowerCase().includes(needle) ||
        (c.dial ?? "").startsWith(needle.replace(/^\+/, "")),
    );
  }, [q]);

  function setNational(next: string) {
    const digits = next.replace(/[^\d]/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    onChange(dial ? `+${dial}${digits}` : `+${digits}`);
  }

  function pickCountry(iso: string) {
    onIsoChange(iso);
    setOpen(false);
    setQ("");
    // Re-compose the number with the new dial code + preserved national digits.
    const newDial = dialCode(iso) ?? "";
    if (nationalDigits) onChange(`+${newDial}${nationalDigits}`);
  }

  return (
    <div
      className={cn(
        "relative flex items-stretch rounded-md border bg-background",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 border-r px-2 text-sm hover:bg-muted/50"
      >
        <span className="text-base leading-none">{flagEmoji(isoCountry)}</span>
        <span className="text-xs text-muted-foreground">
          +{dial || "—"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <input
        type="tel"
        inputMode="numeric"
        value={nationalDigits}
        onChange={(e) => setNational(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 z-50 mt-1 w-72 rounded-md border bg-background shadow-lg">
            <div className="border-b p-2">
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search country or code…"
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
                  onClick={() => pickCountry(c.iso)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted",
                    isoCountry === c.iso && "bg-muted",
                  )}
                >
                  <span className="text-base leading-none">
                    {flagEmoji(c.iso)}
                  </span>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    +{c.dial}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
