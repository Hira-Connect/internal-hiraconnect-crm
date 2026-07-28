"use client";

import { toggleTask } from "@/lib/actions/activities";
import { Button } from "@/components/ui/primitives";
import { useAction } from "@/components/ui/use-action";

export function TaskToggle({ activityId, done }: { activityId: string; done: boolean }) {
  const { run, pending } = useAction();
  return (
    <Button
      size="sm"
      variant={done ? "secondary" : "gold"}
      disabled={pending}
      onClick={() => run(() => toggleTask(activityId, !done))}
    >
      {pending ? "…" : done ? "Done ✓" : "Mark done"}
    </Button>
  );
}
