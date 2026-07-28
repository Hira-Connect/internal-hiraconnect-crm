"use client";

import { useState } from "react";
import { logActivity } from "@/lib/actions/activities";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { actionErrorClass, useAction } from "@/components/ui/use-action";
import { cn } from "@/lib/format";
import type { ActivityType, Direction } from "@/lib/types";

export const ACTIVITY_ICON: Record<string, string> = {
  Note: "📝",
  Call: "📞",
  Email: "✉️",
  WhatsApp: "💬",
  Meeting: "🤝",
  Demo: "🖥️",
  Task: "✅",
  StageChange: "↗️",
};

const TYPES: ActivityType[] = ["Call", "Email", "WhatsApp", "Meeting", "Demo", "Note", "Task"];

const OUTCOME_SUGGESTIONS: Record<string, string[]> = {
  Call: ["Interested", "No answer", "Call back later", "Not a fit"],
  Email: ["Replied", "No reply yet", "Bounced", "Asked for info"],
  WhatsApp: ["Replied", "Read, no reply", "Shared deck"],
  Meeting: ["Went well", "Needs follow-up", "Rescheduled", "No-show"],
  Demo: ["Impressed", "Needs another demo", "Objection raised", "No-show"],
};

/** The single entry point for logging a conversation. Touch types bump the
 *  lead's reachout counter server-side, so the number stays truthful. */
export function ActivityComposer({ leadId }: { leadId: string }) {
  const { run, pending, error } = useAction();
  const [type, setType] = useState<ActivityType>("Call");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [direction, setDirection] = useState<Direction>("out");
  const [dueDate, setDueDate] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDate, setNextDate] = useState("");

  const isTask = type === "Task";
  const isNote = type === "Note";

  const submit = () => {
    run(
      () =>
        logActivity(leadId, {
          type,
          notes,
          outcome: isTask || isNote ? null : outcome,
          direction: isTask || isNote ? null : direction,
          dueDate: isTask ? dueDate || null : null,
          nextAction: nextAction.trim() ? nextAction.trim() : undefined,
          nextActionDate: nextDate || undefined,
        }),
      () => {
        setNotes("");
        setOutcome("");
        setDueDate("");
        setNextAction("");
        setNextDate("");
      },
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
              type === t ? "border-brand-500 bg-brand-500 text-white" : "border-app hover:surface-alt",
            )}
          >
            <span aria-hidden>{ACTIVITY_ICON[t]}</span> {t}
          </button>
        ))}
      </div>

      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={
          isTask
            ? "What needs doing?"
            : isNote
              ? "What should the team know?"
              : "What was said? Keep it useful for whoever picks this up next."
        }
        className="mb-2"
      />

      <div className="mb-2 flex flex-wrap gap-2">
        {isTask ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            Due
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-auto px-2 py-1 text-xs"
            />
          </label>
        ) : isNote ? null : (
          <>
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              aria-label="Direction"
              className="w-auto px-2 py-1 text-xs"
            >
              <option value="out">▲ Outbound</option>
              <option value="in">▼ Inbound</option>
            </Select>
            <Input
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="Outcome"
              list={`outcomes-${type}`}
              className="w-auto flex-1 px-2 py-1 text-xs"
            />
            <datalist id={`outcomes-${type}`}>
              {(OUTCOME_SUGGESTIONS[type] ?? []).map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </>
        )}
      </div>

      <details className="mb-2">
        <summary className="cursor-pointer text-[11px] text-muted select-none">Set the next follow-up too</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          <Input
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="Next action"
            className="w-auto flex-1 px-2 py-1 text-xs"
          />
          <Input
            type="date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            className="w-auto px-2 py-1 text-xs"
          />
        </div>
      </details>

      {error && <p className={actionErrorClass()}>{error}</p>}

      <Button onClick={submit} disabled={pending} size="sm">
        {pending ? "Logging…" : `Log ${type.toLowerCase()}`}
      </Button>
    </div>
  );
}
