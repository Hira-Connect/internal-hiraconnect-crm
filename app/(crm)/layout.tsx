import Link from "next/link";
import { AppNav, type NavItem } from "@/components/layout/app-nav";
import { CommandPalette, type PaletteItem } from "@/components/layout/command-palette";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { getCompanies, getContacts, getLeads, getNotifications, requireProfile } from "@/lib/queries";
import { isManagerUp } from "@/lib/permissions";

const BASE_NAV: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/leads", label: "Leads" },
  { href: "/companies", label: "Companies" },
  { href: "/contacts", label: "Contacts" },
  { href: "/signups", label: "Signups" },
  { href: "/reports", label: "Reports" },
  { href: "/targets", label: "Targets" },
];

const PAGE_ITEMS: PaletteItem[] = [...BASE_NAV, { href: "/team", label: "Team" }].map((n) => ({
  id: n.href,
  label: n.label,
  href: n.href,
  kind: "Page" as const,
}));

/** The shell must render even when a data source is unavailable — otherwise a
 *  missing migration blanks the entire app instead of the page's error panel,
 *  which is where the actionable message lives. */
async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const [leads, companies, contacts, notifications] = await Promise.all([
    safe(getLeads, []),
    safe(getCompanies, []),
    safe(getContacts, []),
    safe(getNotifications, []),
  ]);

  const nav = isManagerUp(profile) ? [...BASE_NAV, { href: "/team", label: "Team" }] : BASE_NAV;

  const paletteItems: PaletteItem[] = [
    ...PAGE_ITEMS,
    ...leads.map((l) => ({
      id: l.id,
      label: l.name,
      sub: [l.company?.name, l.status].filter(Boolean).join(" · "),
      href: `/leads/${l.id}`,
      kind: "Lead" as const,
    })),
    ...companies.map((c) => ({
      id: c.id,
      label: c.name,
      sub: [c.industry, c.location].filter(Boolean).join(" · "),
      href: `/companies?focus=${c.id}`,
      kind: "Company" as const,
    })),
    ...contacts.map((c) => ({
      id: c.id,
      label: c.full_name,
      sub: [c.title, c.email].filter(Boolean).join(" · "),
      href: `/contacts?focus=${c.id}`,
      kind: "Contact" as const,
    })),
  ];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 bg-navy-900 px-4 py-2.5 shadow-md">
        <Link href="/" className="font-display text-base font-bold text-white">
          HIRA <span className="text-gold-500">Connect</span>
        </Link>
        <AppNav items={nav} />
        <div className="ml-auto flex items-center gap-2">
          <CommandPalette items={paletteItems} />
          <ThemeToggle />
          <UserMenu profile={profile} notifications={notifications} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-5">{children}</main>
    </div>
  );
}
