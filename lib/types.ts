/** Hand-maintained row types for the CRM schema.
 *  Regenerate with `supabase gen types typescript` once CLI access is linked. */

/** Uniform server-action return shape. Lives here (not in actions/shared.ts) so
 *  client components can import the type without pulling in server-only code. */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type Role = "admin" | "manager" | "rep";
export type Funnel = "TOFU" | "MOFU" | "BOFU";
export type StageCategory = "open" | "won" | "lost";
export type Direction = "in" | "out";
export type Grade = "A" | "B" | "C" | "D";

export type ActivityType =
  | "Call"
  | "Email"
  | "WhatsApp"
  | "Meeting"
  | "Demo"
  | "Note"
  | "Task"
  | "StageChange";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  team_id: string | null;
  is_active: boolean;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

/** Sign-in state that lives in auth.users, not in `profiles` — used on the Team
 *  screen to tell "invited, never arrived" apart from "active". */
export interface AccountState {
  confirmed: boolean;
  invitedAt: string | null;
  lastSignInAt: string | null;
}

export interface Team {
  id: string;
  name: string;
  description: string | null;
  manager_id: string | null;
  created_at: string;
}

export interface Stage {
  key: string;
  label: string;
  funnel: Funnel;
  category: StageCategory;
  sort: number;
  sla_days: number;
  probability: number;
  is_active: boolean;
}

export interface Company {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  industry: string | null;
  notes: string | null;
  employee_count: number | null;
  size_band: "small" | "mid" | "large" | "enterprise" | null;
  domain: string | null;
  hiring_need: "niche" | "general" | "unknown" | null;
  is_icp: boolean | null;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string | null;
  full_name: string;
  title: string | null;
  seniority: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin: string | null;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  name: string;
  company_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  team_id: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin: string | null;
  owner: string | null;
  status: string;
  source: string | null;
  next_action: string | null;
  next_action_date: string | null;
  total_reachouts: number | null;
  score_fit: number;
  score_engagement: number;
  score_total: number;
  grade: Grade | null;
  score_updated_at: string | null;
  stage_since: string | null;
  lost_reason: string | null;
  expected_value: number | null;
  close_date: string | null;
  currency: string;
  priority: string | null;
  last_activity_at: string | null;
  first_contacted_at: string | null;
  qualified_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  created_at: string;
}

export type CompanyBrief = Pick<
  Company,
  "id" | "name" | "industry" | "size_band" | "employee_count" | "is_icp" | "hiring_need" | "location"
>;

export type ProfileBrief = Pick<Profile, "id" | "full_name" | "email">;

/** Lead joined with the relations the UI actually renders.
 *  Embed aliases are set in lib/queries.ts — `company` and `owner_profile`
 *  (not `owner`, which is a legacy text column on leads). */
export interface LeadRow extends Lead {
  company: CompanyBrief | null;
  owner_profile: ProfileBrief | null;
}

export interface Activity {
  id: string;
  lead_id: string;
  contact_id: string | null;
  owner_id: string | null;
  type: ActivityType;
  direction: Direction | null;
  notes: string | null;
  outcome: string | null;
  activity_date: string | null;
  due_date: string | null;
  done: boolean;
  completed_at: string | null;
  author: string | null;
  created_at: string;
}

export interface ActivityRow extends Activity {
  author_profile: ProfileBrief | null;
}

export interface StageHistory {
  id: string;
  lead_id: string;
  from_stage: string | null;
  to_stage: string;
  note: string | null;
  changed_by: string | null;
  changed_by_id: string | null;
  days_in_from_stage: number | null;
  changed_at: string;
}

export interface ScoreHistory {
  id: string;
  lead_id: string;
  score_fit: number;
  score_engagement: number;
  score_total: number;
  grade: Grade | null;
  reason: string | null;
  created_at: string;
}

export interface RawSignup {
  id: string;
  name: string | null;
  email: string;
  submit_type: string | null;
  source: string | null;
  submitted_at: string | null;
  created_at: string | null;
  converted_lead_id: string | null;
}

export interface MonthlyTarget {
  id: string;
  month: string;
  metric: string;
  target_value: number;
  actual_value: number;
  owner: string | null;
  owner_id: string | null;
  team_id: string | null;
  auto_actual: boolean;
  notes: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  lead_id: string | null;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}
