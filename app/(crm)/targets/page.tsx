import type { Metadata } from "next";
import { TargetManager } from "@/components/targets/target-manager";
import { getProfiles, getTargets, requireProfile } from "@/lib/queries";

export const metadata: Metadata = { title: "Targets" };

export default async function TargetsPage() {
  const [me, targets, profiles] = await Promise.all([requireProfile(), getTargets(), getProfiles()]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl">Targets</h1>
        <p className="text-xs text-muted">
          Monthly quotas per person or company-wide. Actuals are computed from the CRM&apos;s own data, so the
          numbers cannot drift from reality.
        </p>
      </header>

      <TargetManager targets={targets} profiles={profiles} me={me} />
    </div>
  );
}
