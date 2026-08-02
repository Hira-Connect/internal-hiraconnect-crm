import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { DEFAULT_STAGES } from "./stages";
import type {
  AccountState,
  ActivityRow,
  Company,
  Contact,
  LeadRow,
  MonthlyTarget,
  Notification,
  Profile,
  RawSignup,
  ScoreHistory,
  Stage,
  StageHistory,
  Team,
} from "./types";

export const LEAD_SELECT = `
  *,
  company:companies(id,name,industry,size_band,employee_count,is_icp,hiring_need,location),
  owner_profile:profiles!leads_owner_id_fkey(id,full_name,email)
` as const;

const ACTIVITY_SELECT = `
  *,
  author_profile:profiles!activities_owner_id_fkey(id,full_name,email)
` as const;

/* ------------------------------------------------------------------ session */

/** The signed-in user's profile. Redirects to /login when there is no session.
 *  `cache` dedupes this across every component in a single render pass. */
export const requireProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (!profile) {
    // The handle_new_user trigger should have created this. If the migration
    // has not been pushed yet, fall back to a read-only admin-less shell.
    return {
      id: user.id,
      email: user.email ?? null,
      full_name: user.email?.split("@")[0] ?? null,
      role: "rep",
      team_id: null,
      is_active: true,
      phone: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  return profile as Profile;
});

/* ------------------------------------------------------------------ config */

export const getStages = cache(async (): Promise<Stage[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("stages").select("*").order("sort");
  if (error || !data?.length) return DEFAULT_STAGES;
  return data as Stage[];
});

export const getProfiles = cache(async (): Promise<Profile[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("full_name");
  return (data ?? []) as Profile[];
});

/** Invite/sign-in state per user id, read from Supabase Auth with the service
 *  key. Admins only — everyone else (and a deployment without the key) gets an
 *  empty map, and the Team screen simply omits the column. */
export const getAccountStates = cache(async (): Promise<Record<string, AccountState>> => {
  const me = await requireProfile();
  if (me.role !== "admin" || !me.is_active) return {};

  const admin = createAdminClient();
  if (!admin) return {};

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error || !data) return {};

  const states: Record<string, AccountState> = {};
  for (const user of data.users) {
    states[user.id] = {
      confirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
      invitedAt: (user as { invited_at?: string }).invited_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
    };
  }
  return states;
});

export const getTeams = cache(async (): Promise<Team[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("teams").select("*").order("name");
  return (data ?? []) as Team[];
});

export const getLostReasons = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("lost_reasons").select("reason").order("sort");
  const rows = (data ?? []) as { reason: string }[];
  return rows.length
    ? rows.map((r) => r.reason)
    : ["Price", "Timing", "No budget", "Went silent", "Competitor", "Not a fit", "No response"];
});

/* ------------------------------------------------------------------ leads */

export interface LeadFilters {
  ownerId?: string;
  status?: string;
  grade?: string;
  search?: string;
  onlyOpen?: boolean;
}

export const getLeads = cache(async (filters: LeadFilters = {}): Promise<LeadRow[]> => {
  const supabase = await createClient();
  let q = supabase.from("leads").select(LEAD_SELECT).order("created_at", { ascending: false });

  if (filters.ownerId === "unassigned") q = q.is("owner_id", null);
  else if (filters.ownerId) q = q.eq("owner_id", filters.ownerId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.grade) q = q.eq("grade", filters.grade);
  if (filters.onlyOpen) q = q.not("status", "in", "(Won,Lost)");
  if (filters.search) {
    const s = `%${filters.search}%`;
    q = q.or(`name.ilike.${s},email.ilike.${s},phone.ilike.${s},title.ilike.${s}`);
  }

  const { data, error } = await q;
  if (error) throw new Error(`Failed to load leads: ${error.message}`);
  return (data ?? []) as unknown as LeadRow[];
});

export const getLead = cache(async (id: string): Promise<LeadRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select(LEAD_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as LeadRow) ?? null;
});

export const getLeadActivities = cache(async (leadId: string): Promise<ActivityRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as ActivityRow[];
});

export const getLeadStageHistory = cache(async (leadId: string): Promise<StageHistory[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stage_history")
    .select("*")
    .eq("lead_id", leadId)
    .order("changed_at", { ascending: false });
  return (data ?? []) as StageHistory[];
});

export const getLeadScoreHistory = cache(async (leadId: string): Promise<ScoreHistory[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lead_score_history")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as ScoreHistory[];
});

/** Open tasks assigned to me, plus overdue ones — drives the Today panel. */
export const getMyTasks = cache(async (userId: string): Promise<ActivityRow[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT)
    .eq("type", "Task")
    .eq("done", false)
    .eq("owner_id", userId)
    .order("due_date", { ascending: true })
    .limit(50);
  return (data ?? []) as unknown as ActivityRow[];
});

/* ------------------------------------------------------------- accounts */

export const getCompanies = cache(async (): Promise<Company[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("*").order("name");
  return (data ?? []) as Company[];
});

export const getContacts = cache(async (): Promise<Contact[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("contacts").select("*").order("full_name");
  return (data ?? []) as Contact[];
});

export const getSignups = cache(async (): Promise<RawSignup[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("raw_signups")
    .select("*")
    .order("submitted_at", { ascending: false, nullsFirst: false });
  return (data ?? []) as RawSignup[];
});

/* ------------------------------------------------------------- targets */

export const getTargets = cache(async (): Promise<MonthlyTarget[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("monthly_targets")
    .select("*")
    .order("month", { ascending: false })
    .order("metric");
  return (data ?? []) as MonthlyTarget[];
});

/* --------------------------------------------------------- notifications */

export const getNotifications = cache(async (): Promise<Notification[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as Notification[];
});

/* --------------------------------------------------------- analytics */

/** All stage transitions visible to the user — the basis for funnel & velocity. */
export const getAllStageHistory = cache(async (): Promise<StageHistory[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stage_history")
    .select("*")
    .order("changed_at", { ascending: true })
    .limit(5000);
  return (data ?? []) as StageHistory[];
});

/** Activity rows for the reporting window (default 120 days). */
export const getRecentActivities = cache(async (days = 120): Promise<ActivityRow[]> => {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("activities")
    .select(ACTIVITY_SELECT)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  return (data ?? []) as unknown as ActivityRow[];
});
