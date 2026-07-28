"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updatePassword, type AuthState } from "@/lib/actions/auth";
import { Button, Field, Input } from "@/components/ui/primitives";

const INITIAL: AuthState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : "Save password"}
    </Button>
  );
}

export function UpdatePasswordForm() {
  const [state, action] = useActionState(updatePassword, INITIAL);

  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {state.error}
        </p>
      )}
      <Field label="New password">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <SubmitButton />
      <Link href="/login" className="block text-center text-xs text-muted hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
