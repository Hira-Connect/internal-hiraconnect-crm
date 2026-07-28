"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  href: string;
  kind: "Lead" | "Company" | "Contact" | "Page";
}

const KIND_STYLES: Record<PaletteItem["kind"], string> = {
  Lead: "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100",
  Company: "bg-gold-100 text-gold-600 dark:bg-gold-500/20 dark:text-gold-300",
  Contact: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  Page: "bg-navy-100 text-navy-700 dark:bg-navy-700 dark:text-navy-200",
};

export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  /** Always open on a clean slate — no stale query from the last visit. */
  const openPalette = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((wasOpen) => {
          if (wasOpen) return false;
          setQuery("");
          setActive(0);
          return true;
        });
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.filter((i) => i.kind === "Page").slice(0, 8);
    return items
      .filter((i) => `${i.label} ${i.sub ?? ""}`.toLowerCase().includes(q))
      .slice(0, 25);
  }, [items, query]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPalette}
        className="hidden items-center gap-2 rounded-lg border border-navy-600 px-2.5 py-1.5 text-xs text-navy-300 transition-colors hover:bg-navy-700 sm:inline-flex"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        Search
        <kbd className="rounded border border-navy-500 px-1 font-sans text-[10px]">⌘K</kbd>
      </button>
    );
  }

  const go = (item: PaletteItem) => {
    setOpen(false);
    router.push(item.href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-navy-950/60 px-4 pt-[12vh]">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close search" onClick={() => setOpen(false)} />
      <div className="surface relative w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl">
        <input
          /* the palette is a keyboard-first overlay — focusing the field is the point */
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(results[active]);
            }
          }}
          placeholder="Search leads, companies, contacts…"
          className="w-full border-b border-app bg-transparent px-4 py-3.5 text-sm outline-none"
        />
        <ul className="max-h-80 overflow-y-auto scroll-thin py-1">
          {results.length === 0 && <li className="px-4 py-6 text-center text-xs text-muted">No matches.</li>}
          {results.map((item, i) => (
            <li key={`${item.kind}-${item.id}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(item)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                  i === active ? "surface-alt" : ""
                }`}
              >
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${KIND_STYLES[item.kind]}`}>
                  {item.kind}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.sub && <span className="block truncate text-[11px] text-muted">{item.sub}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
