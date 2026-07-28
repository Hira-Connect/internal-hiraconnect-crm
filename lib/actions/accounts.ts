"use server";

import { revalidatePath } from "next/cache";
import { currentActor, emptyToNull, fail, numOrNull, ok, type ActionResult } from "./shared";

function bandFor(count: number | null): string | null {
  if (count === null) return null;
  if (count < 50) return "small";
  if (count < 250) return "mid";
  if (count < 1000) return "large";
  return "enterprise";
}

function domainFrom(website: string | null): string | null {
  if (!website) return null;
  return website
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase() || null;
}

/* ---------------------------------------------------------------- companies */

export async function createCompany(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const name = emptyToNull(formData.get("name"));
  if (!name) return fail("Company name is required.");

  const website = emptyToNull(formData.get("website"));
  const employeeCount = numOrNull(formData.get("employee_count"));

  const { data, error } = await supabase
    .from("companies")
    .insert({
      name,
      website,
      domain: domainFrom(website),
      location: emptyToNull(formData.get("location")),
      industry: emptyToNull(formData.get("industry")),
      employee_count: employeeCount,
      size_band: emptyToNull(formData.get("size_band")) ?? bandFor(employeeCount),
      hiring_need: emptyToNull(formData.get("hiring_need")),
      is_icp: formData.get("is_icp") === "on" || formData.get("is_icp") === "true",
      notes: emptyToNull(formData.get("notes")),
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return fail(error?.message ?? "Could not create the company.");

  revalidatePath("/companies");
  revalidatePath("/leads");
  return ok({ id: data.id as string });
}

export async function updateCompany(companyId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const name = emptyToNull(formData.get("name"));
  if (!name) return fail("Company name is required.");

  const website = emptyToNull(formData.get("website"));
  const employeeCount = numOrNull(formData.get("employee_count"));

  const { error } = await supabase
    .from("companies")
    .update({
      name,
      website,
      domain: domainFrom(website),
      location: emptyToNull(formData.get("location")),
      industry: emptyToNull(formData.get("industry")),
      employee_count: employeeCount,
      size_band: emptyToNull(formData.get("size_band")) ?? bandFor(employeeCount),
      hiring_need: emptyToNull(formData.get("hiring_need")),
      is_icp: formData.get("is_icp") === "on" || formData.get("is_icp") === "true",
      notes: emptyToNull(formData.get("notes")),
    })
    .eq("id", companyId);
  if (error) return fail(error.message);

  // firmographics feed the fit score — leads on this company are now stale
  revalidatePath("/companies");
  revalidatePath("/leads");
  return ok();
}

/** ICP and size drive the fit score, so this is the one toggle worth an inline control. */
export async function setCompanyIcp(companyId: string, isIcp: boolean): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const { error } = await supabase.from("companies").update({ is_icp: isIcp }).eq("id", companyId);
  if (error) return fail(error.message);

  revalidatePath("/companies");
  return ok();
}

/* ----------------------------------------------------------------- contacts */

export async function createContact(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const fullName = emptyToNull(formData.get("full_name"));
  if (!fullName) return fail("Contact name is required.");

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      full_name: fullName,
      company_id: emptyToNull(formData.get("company_id")),
      title: emptyToNull(formData.get("title")),
      email: emptyToNull(formData.get("email")),
      phone: emptyToNull(formData.get("phone")),
      whatsapp: emptyToNull(formData.get("whatsapp")),
      linkedin: emptyToNull(formData.get("linkedin")),
      notes: emptyToNull(formData.get("notes")),
      is_primary: formData.get("is_primary") === "on",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return fail(error?.message ?? "Could not create the contact.");

  revalidatePath("/contacts");
  return ok({ id: data.id as string });
}

export async function updateContact(contactId: string, formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");

  const fullName = emptyToNull(formData.get("full_name"));
  if (!fullName) return fail("Contact name is required.");

  const { error } = await supabase
    .from("contacts")
    .update({
      full_name: fullName,
      company_id: emptyToNull(formData.get("company_id")),
      title: emptyToNull(formData.get("title")),
      email: emptyToNull(formData.get("email")),
      phone: emptyToNull(formData.get("phone")),
      whatsapp: emptyToNull(formData.get("whatsapp")),
      linkedin: emptyToNull(formData.get("linkedin")),
      notes: emptyToNull(formData.get("notes")),
      is_primary: formData.get("is_primary") === "on",
    })
    .eq("id", contactId);
  if (error) return fail(error.message);

  revalidatePath("/contacts");
  return ok();
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  const { supabase, profile, userId } = await currentActor();
  if (!userId) return fail("Not signed in.");
  if (!profile || (profile.role !== "admin" && profile.role !== "manager")) {
    return fail("Only managers and admins can delete contacts.");
  }

  const { error } = await supabase.from("contacts").delete().eq("id", contactId);
  if (error) return fail(error.message);

  revalidatePath("/contacts");
  return ok();
}
