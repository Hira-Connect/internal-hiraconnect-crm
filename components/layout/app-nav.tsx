"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/format";

export interface NavItem {
  href: string;
  label: string;
}

export function AppNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <button
        type="button"
        aria-label="Toggle navigation"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-navy-600 p-1.5 text-navy-200 md:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <nav
        className={cn(
          "order-last w-full gap-1 md:order-none md:flex md:w-auto md:flex-wrap",
          open ? "flex flex-wrap pt-2" : "hidden",
        )}
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              isActive(item.href) ? "bg-brand-500 text-white" : "text-navy-200 hover:bg-navy-700",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
