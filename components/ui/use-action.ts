"use client";

import { useCallback, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";

/** Wraps a server action with pending state and a surfaced error message.
 *  Keeps every mutating control in the UI consistent: optimistic-feeling,
 *  but honest when the database refuses (usually an RLS denial). */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T,>(action: () => Promise<ActionResult<T>>, onDone?: (data: T | undefined) => void) => {
      setError(null);
      startTransition(async () => {
        try {
          const result = await action();
          if (!result.ok) setError(result.error);
          else onDone?.(result.data);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
        }
      });
    },
    [],
  );

  return { run, pending, error, clearError: () => setError(null) };
}

/** Inline error line shared by the client widgets. */
export function actionErrorClass() {
  return "mt-1 text-[11px] text-red-600 dark:text-red-400";
}
