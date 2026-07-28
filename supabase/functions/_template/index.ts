// _template — reference edge function for HIRA Connect CRM.
// Dirs starting with "_" are NOT deployed by the CLI, so this stays a safe copy-me starting point.
//
// To make a real function:  cp -r supabase/functions/_template supabase/functions/my-func
// Deploy:                    supabase functions deploy my-func --project-ref tcojgrxtpldiieytvthl
// Secrets:                   supabase secrets set FOO=bar   (SUPABASE_URL / SERVICE_ROLE_KEY are injected)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { preflight, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    // Service-role client — bypasses RLS. Never expose this key to the browser.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Example: how many leads need a follow-up today.
    const today = new Date().toISOString().slice(0, 10);
    const { count, error } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("next_action_date", today);
    if (error) throw error;

    return json({ ok: true, due_today: count ?? 0 });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
