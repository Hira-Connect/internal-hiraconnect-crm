/** Presentation helpers. No I/O, safe on server and client. */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function todayISO(now: Date = new Date()): string {
  // local calendar day, not UTC — "due today" must match the user's day
  const tz = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - tz).toISOString().slice(0, 10);
}

export function monthISO(now: Date = new Date()): string {
  return todayISO(now).slice(0, 7);
}

export function relTime(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return "—";
  const secs = (now.getTime() - then.getTime()) / 1000;
  if (secs < 0) return "scheduled";
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604_800) return `${Math.floor(secs / 86_400)}d ago`;
  if (secs < 2_592_000) return `${Math.floor(secs / 604_800)}w ago`;
  return then.toISOString().slice(0, 10);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMonth(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** Indian short-scale currency — ₹8.2L / ₹1.4Cr reads better than ₹820,000 here. */
export function formatCurrency(value: number | null | undefined, currency = "INR"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (currency === "INR") {
    const abs = Math.abs(value);
    if (abs >= 10_000_000) return `₹${trim(value / 10_000_000)}Cr`;
    if (abs >= 100_000) return `₹${trim(value / 100_000)}L`;
    if (abs >= 1_000) return `₹${trim(value / 1_000)}K`;
    return `₹${Math.round(value)}`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function displayName(
  profile: { full_name: string | null; email: string | null } | null | undefined,
): string {
  if (!profile) return "Unassigned";
  return profile.full_name || profile.email?.split("@")[0] || "Unknown";
}

function trim(n: number): string {
  return n.toFixed(n < 10 ? 1 : 0).replace(/\.0$/, "");
}

/** Deterministic pastel per string — used for avatars and source chips. */
export function hashHue(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) % 360;
  return h;
}
