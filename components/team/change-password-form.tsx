"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changeMyPassword, type AuthState } from "@/lib/actions/auth";
import { Button, Field, Input } from "@/components/ui/primitives";

const INITIAL: AuthState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Change password"}
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState(changeMyPassword, INITIAL);

  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {state.error}
        </p>
      )}
      {state.done && !state.error && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          Password changed. Use the new one next time you sign in.
        </p>
      )}
      <Field label="Current password">
        <Input name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <SubmitButton />
    </form>
  );
}
