"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { sendPasswordReset, signIn, type AuthState } from "@/lib/actions/auth";
import { Button, Field, Input } from "@/components/ui/primitives";

const INITIAL: AuthState = { error: null };

function SubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Working…" : children}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [signInState, signInAction] = useActionState(signIn, INITIAL);
  const [resetState, resetAction] = useActionState(sendPasswordReset, INITIAL);

  if (mode === "reset") {
    return (
      <form action={resetAction} className="space-y-3">
        {resetState.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
            {resetState.error}
          </p>
        )}
        {resetState.done && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            If that address has an account, a reset link is on its way — it works on any device, and expires
            within the hour. Check your spam folder if it does not arrive.
          </p>
        )}
        <p className="text-xs text-muted">
          Enter your work email and we will send you a one-time link to set a new password.
        </p>
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required placeholder="you@hiraconnect.com" />
        </Field>
        <SubmitButton>Send reset link</SubmitButton>
        <button
          type="button"
          onClick={() => setMode("signin")}
          className="w-full text-center text-xs text-muted hover:underline"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form action={signInAction} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      {signInState.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300">
          {signInState.error}
        </p>
      )}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@hiraconnect.com" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
      </Field>
      <SubmitButton>Sign in</SubmitButton>
      <button
        type="button"
        onClick={() => setMode("reset")}
        className="w-full text-center text-xs text-muted hover:underline"
      >
        Forgot your password?
      </button>
    </form>
  );
}
