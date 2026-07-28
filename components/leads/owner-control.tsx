"use client";

import { assignOwner } from "@/lib/actions/leads";
import { Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { displayName } from "@/lib/format";
import type { Profile } from "@/lib/types";

export function OwnerControl({
  leadId,
  ownerId,
  options,
  disabled,
  size = "md",
}: {
  leadId: string;
  ownerId: string | null;
  options: Profile[];
  disabled?: boolean;
  size?: "sm" | "md";
}) {
  const { run, pending, error } = useAction();

  if (disabled) {
    const owner = options.find((p) => p.id === ownerId);
    return <span className="text-xs">{ownerId ? displayName(owner ?? null) : "Unassigned"}</span>;
  }

  return (
    <div>
      <Select
        value={ownerId ?? ""}
        disabled={pending}
        aria-label="Lead owner"
        onChange={(e) => run(() => assignOwner(leadId, e.target.value || null))}
        className={size === "sm" ? "px-2 py-1 text-xs" : undefined}
      >
        <option value="">Unassigned</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {displayName(p)}
          </option>
        ))}
      </Select>
      {error && <p className={actionErrorClass()}>{error}</p>}
    </div>
  );
}
