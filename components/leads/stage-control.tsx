"use client";

import { useState } from "react";
import { changeStage } from "@/lib/actions/leads";
import { Button, Input, Select } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { findStage } from "@/lib/stages";
import type { Stage } from "@/lib/types";

/** Stage mover. Lost and Delayed open a reason prompt before the move is allowed —
 *  the database rejects them without one, so we ask rather than fail. */
export function StageControl({
  leadId,
  current,
  stages,
  lostReasons,
  size = "md",
}: {
  leadId: string;
  current: string;
  stages: Stage[];
  lostReasons: string[];
  size?: "sm" | "md";
}) {
  const { run, pending, error } = useAction();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState(lostReasons[0] ?? "");
  const [note, setNote] = useState("");

  const needsReason = (stage: string) => {
    const config = findStage(stages, stage);
    return config?.category === "lost" || stage === "Delayed";
  };

  const onSelect = (value: string) => {
    if (value === current) return;
    if (needsReason(value)) {
      setTarget(value);
      setReason(lostReasons[0] ?? "");
      setNote("");
      return;
    }
    run(() => changeStage(leadId, value, null));
  };

  const confirm = () => {
    if (!target) return;
    const combined = [reason, note.trim()].filter(Boolean).join(" — ");
    run(() => changeStage(leadId, target, combined || reason), () => setTarget(null));
  };

  return (
    <div className="relative">
      <Select
        value={current}
        disabled={pending}
        onChange={(e) => onSelect(e.target.value)}
        aria-label="Lead stage"
        className={size === "sm" ? "px-2 py-1 text-xs" : undefined}
      >
        {stages
          .filter((s) => s.is_active)
          .map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
      </Select>

      {error && <p className={actionErrorClass()}>{error}</p>}

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
          <button
            type="button"
            aria-label="Cancel"
            className="absolute inset-0 cursor-default"
            onClick={() => setTarget(null)}
          />
          <div className="surface relative w-full max-w-sm rounded-xl border p-5 shadow-2xl">
            <h3 className="text-sm">
              Why is this moving to <span className="font-bold">{target}</span>?
            </h3>
            <p className="mt-1 text-xs text-muted">
              Recorded on the timeline and used in the lost-reason report.
            </p>

            <div className="mt-4 space-y-3">
              <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                {lostReasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything worth remembering (optional)"
              />
            </div>

            {error && <p className={actionErrorClass()}>{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setTarget(null)} disabled={pending}>
                Cancel
              </Button>
              <Button size="sm" onClick={confirm} disabled={pending || !reason}>
                {pending ? "Saving…" : `Move to ${target}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
