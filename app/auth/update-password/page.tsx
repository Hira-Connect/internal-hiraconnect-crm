import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { UpdatePasswordForm } from "./update-password-form";

export const metadata: Metadata = { title: "Set a password" };

/** Reached three ways: from an invitation link (`welcome=1`), from a reset link,
 *  or by a signed-in user who wants to rotate their password. All three need a
 *  session — /auth/confirm establishes one from the emailed token. */
export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invited = welcome === "1";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy-900 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-display text-xl font-bold text-white">
            HIRA <span className="text-gold-500">Connect</span>
          </p>
        </div>
        <div className="rounded-2xl bg-white p-7 shadow-2xl dark:bg-navy-800">
          {user ? (
            <>
              <h1 className="text-lg">{invited ? "Welcome — choose a password" : "Set a new password"}</h1>
              <p className="mt-1 mb-5 text-xs text-muted">
                {invited
                  ? `You are setting up ${user.email}. Pick something at least 8 characters long; you will be signed in straight afterwards.`
                  : "Choose something at least 8 characters long. You will stay signed in afterwards."}
              </p>
              <UpdatePasswordForm />
            </>
          ) : (
            <>
              <h1 className="text-lg">This link is no longer valid</h1>
              <p className="mt-1 mb-5 text-xs text-muted">
                Invitation and reset links work once and expire. Ask for a new one from the sign-in page, or
                ask an admin to resend your invitation.
              </p>
              <Link href="/login" className="text-xs text-brand-500 hover:underline">
                Back to sign in →
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
