/** UI-side mirror of the RLS policies in 20260729120200_v2_rls.sql.
 *
 *  The database is the authority — these helpers only decide what to *show*, so a
 *  rep never clicks a button that would fail with a permission error. If you change
 *  a policy, change the matching function here.
 */

import type { Profile, Role } from "./types";

export const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: "admin", label: "Admin", blurb: "Full access to every lead, user and setting" },
  { value: "manager", label: "Manager", blurb: "Their team's leads, targets and reports" },
  { value: "rep", label: "Sales rep", blurb: "Only the leads they own" },
];

export function roleLabel(role: Role | null | undefined): string {
  return ROLES.find((r) => r.value === role)?.label ?? "No access";
}

export function isAdmin(me: Profile | null): boolean {
  return me?.is_active === true && me.role === "admin";
}

export function isManagerUp(me: Profile | null): boolean {
  return me?.is_active === true && (me.role === "admin" || me.role === "manager");
}

/** Mirrors public.crm_can_see_lead(owner_id, team_id). */
export function canSeeLead(
  me: Profile | null,
  lead: { owner_id: string | null; team_id: string | null },
  teammateIds: Set<string> = new Set(),
): boolean {
  if (!me?.is_active) return false;
  if (me.role === "admin") return true;
  if (me.role === "manager") {
    return (
      lead.owner_id === null ||
      lead.owner_id === me.id ||
      lead.team_id === me.team_id ||
      (lead.owner_id !== null && teammateIds.has(lead.owner_id))
    );
  }
  return lead.owner_id === me.id;
}

export function canEditLead(
  me: Profile | null,
  lead: { owner_id: string | null; team_id: string | null },
  teammateIds?: Set<string>,
): boolean {
  return canSeeLead(me, lead, teammateIds);
}

export function canDeleteLead(
  me: Profile | null,
  lead: { owner_id: string | null; team_id: string | null },
  teammateIds?: Set<string>,
): boolean {
  return isManagerUp(me) && canSeeLead(me, lead, teammateIds);
}

/** Only managers and admins may hand a lead to someone else. */
export function canReassign(me: Profile | null): boolean {
  return isManagerUp(me);
}

export function canManageTargets(me: Profile | null): boolean {
  return isManagerUp(me);
}

export function canManageTeam(me: Profile | null): boolean {
  return isAdmin(me);
}

export function canManageStages(me: Profile | null): boolean {
  return isAdmin(me);
}

/** Which profiles may be picked as an owner for a new/edited lead. */
export function assignableOwners(me: Profile | null, all: Profile[]): Profile[] {
  if (!me) return [];
  const active = all.filter((p) => p.is_active);
  if (me.role === "admin") return active;
  if (me.role === "manager") return active.filter((p) => p.team_id === me.team_id || p.id === me.id);
  return active.filter((p) => p.id === me.id);
}
