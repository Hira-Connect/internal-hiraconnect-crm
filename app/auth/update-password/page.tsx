import type { Metadata } from "next";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default function UpdatePasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-display text-xl font-bold text-white">
            HIRA <span className="text-gold-500">Connect</span>
          </p>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-2xl dark:bg-navy-800">
          <h1 className="text-lg">Set a new password</h1>
          <p className="mt-1 mb-5 text-xs text-muted">
            Choose something at least 8 characters long. You will stay signed in afterwards.
          </p>
          <UpdatePasswordForm />
        </div>
      </div>
    </main>
  );
}
