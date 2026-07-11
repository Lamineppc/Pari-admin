"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UsersRound, Users as UsersIcon, Store as StoreIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { search, type SearchResult } from "@/lib/search";

const DEBOUNCE_MS = 200;

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{
    groups: SearchResult[];
    users: SearchResult[];
    stores: SearchResult[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Cmd+K / Ctrl+K to focus the search input from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search on input change.
  useEffect(() => {
    if (q.trim().length === 0) {
      setResults(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await search(q);
        setResults(r);
      } catch {
        setResults({ groups: [], users: [], stores: [] });
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Close the dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  const flat = useMemo(() => {
    if (!results) return [] as SearchResult[];
    return [...results.groups, ...results.users, ...results.stores];
  }, [results]);

  function pick(r: SearchResult) {
    setOpen(false);
    setQ("");
    setResults(null);
    if (r.kind === "group") router.push(`/groups?selected=${r.id}`);
    else if (r.kind === "user") router.push(`/users?selected=${r.id}`);
    else router.push(`/store-applications?selected=${r.id}`);
  }

  const showEmpty = q.trim().length > 0 && !loading && results && flat.length === 0;

  return (
    <div ref={wrapperRef} className="relative flex-1 max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        placeholder="Search groups, users, stores…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => q.length > 0 && setOpen(true)}
        className="pl-9 pr-14"
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        ⌘K
      </span>

      {open && (loading || results) && (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg">
          {loading && (
            <div className="p-3 text-xs text-muted-foreground">Searching…</div>
          )}
          {showEmpty && (
            <div className="p-3 text-xs text-muted-foreground">
              No matches for &quot;{q}&quot;.
            </div>
          )}
          {results && !loading && (
            <>
              {results.groups.length > 0 && (
                <ResultsGroup
                  label="Groups"
                  icon={<UsersRound className="h-3 w-3" />}
                  items={results.groups}
                  onPick={pick}
                />
              )}
              {results.users.length > 0 && (
                <ResultsGroup
                  label="Users"
                  icon={<UsersIcon className="h-3 w-3" />}
                  items={results.users}
                  onPick={pick}
                />
              )}
              {results.stores.length > 0 && (
                <ResultsGroup
                  label="Stores"
                  icon={<StoreIcon className="h-3 w-3" />}
                  items={results.stores}
                  onPick={pick}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ResultsGroup({
  label,
  icon,
  items,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  items: SearchResult[];
  onPick: (r: SearchResult) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <ul>
        {items.map((r) => (
          <li
            key={`${r.kind}:${r.id}`}
            onClick={() => onPick(r)}
            className="cursor-pointer border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted"
          >
            <div className="truncate font-medium">{r.title}</div>
            <div className="truncate text-xs text-muted-foreground">
              {r.subtitle}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
