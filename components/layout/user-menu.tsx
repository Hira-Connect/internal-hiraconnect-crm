"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/lib/actions/auth";
import { markNotificationsReadAction } from "@/lib/actions/activities";
import { Avatar } from "@/components/ui/primitives";
import { relTime } from "@/lib/format";
import { roleLabel } from "@/lib/permissions";
import type { Notification, Profile } from "@/lib/types";

export function UserMenu({ profile, notifications }: { profile: Profile; notifications: Notification[] }) {
  const [open, setOpen] = useState<"none" | "user" | "bell">("none");
  const wrapRef = useRef<HTMLDivElement>(null);
  const unread = notifications.filter((n) => !n.read_at);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen("none");
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      <button
        type="button"
        aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ""}`}
        onClick={() => setOpen((v) => (v === "bell" ? "none" : "bell"))}
        className="relative rounded-lg border border-navy-600 p-1.5 text-navy-200 transition-colors hover:bg-navy-700"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>

      <button
        type="button"
        onClick={() => setOpen((v) => (v === "user" ? "none" : "user"))}
        className="flex items-center gap-2 rounded-lg border border-navy-600 py-1 pr-2.5 pl-1 transition-colors hover:bg-navy-700"
      >
        <Avatar name={profile.full_name ?? profile.email} size={22} />
        <span className="hidden text-xs text-navy-200 sm:inline">{profile.full_name ?? profile.email}</span>
      </button>

      {open === "bell" && (
        <div className="surface absolute top-full right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border shadow-xl">
          <div className="flex items-center justify-between border-b border-app px-3 py-2">
            <span className="text-xs font-semibold">Notifications</span>
            {unread.length > 0 && (
              <form action={markNotificationsReadAction}>
                <button type="submit" className="text-[11px] text-brand-500 hover:underline">
                  Mark all read
                </button>
              </form>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto scroll-thin">
            {notifications.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted">Nothing yet.</li>
            )}
            {notifications.map((n) => (
              <li key={n.id} className={`border-b border-app px-3 py-2 last:border-0 ${n.read_at ? "" : "surface-alt"}`}>
                {n.lead_id ? (
                  <Link href={`/leads/${n.lead_id}`} onClick={() => setOpen("none")} className="block">
                    <p className="text-xs font-medium">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-[11px] text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] text-muted">{relTime(n.created_at)}</p>
                  </Link>
                ) : (
                  <>
                    <p className="text-xs font-medium">{n.title}</p>
                    {n.body && <p className="mt-0.5 text-[11px] text-muted">{n.body}</p>}
                    <p className="mt-0.5 text-[10px] text-muted">{relTime(n.created_at)}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open === "user" && (
        <div className="surface absolute top-full right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border shadow-xl">
          <div className="border-b border-app px-3 py-2.5">
            <p className="truncate text-sm font-medium">{profile.full_name ?? "—"}</p>
            <p className="truncate text-[11px] text-muted">{profile.email}</p>
            <p className="mt-1 text-[11px] text-muted">{roleLabel(profile.role)}</p>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen("none")}
            className="block px-3 py-2 text-sm transition-colors hover:surface-alt"
          >
            My profile
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full px-3 py-2 text-left text-sm text-red-600 transition-colors hover:surface-alt dark:text-red-400"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
