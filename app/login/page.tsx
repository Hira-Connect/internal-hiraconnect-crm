import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-display text-xl font-bold text-white">
            HIRA <span className="text-gold-500">Connect</span>
          </p>
          <p className="mt-1 text-xs text-navy-300">CRM &amp; Business Planning Portal</p>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-2xl dark:bg-navy-800">
          <h1 className="text-lg">Sign in</h1>
          <p className="mt-1 mb-5 text-xs text-muted">Use the account your admin created for you.</p>
          {reason && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {reason}
            </p>
          )}
          <LoginForm next={next ?? "/"} />
        </div>
        <p className="mt-4 text-center text-[11px] text-navy-400">
          Internal system. Access is logged and scoped to your role.
        </p>
      </div>
    </main>
  );
}
