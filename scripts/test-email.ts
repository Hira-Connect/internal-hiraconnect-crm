/**
 * Send a real account email through the configured transport, to prove the
 * credentials work before anyone depends on them.
 *
 *   npm run mail:test -- --to you@hiraconnect.com
 *   npm run mail:test -- --to you@hiraconnect.com --template invite
 *
 * Reads the same variables the app does, from .env.local. Nothing here touches
 * Supabase — the link in the sample email is a dummy.
 */

import { mailFrom, mailerConfigured, sendMail } from "../lib/email/send";
import { inviteEmail, passwordResetEmail } from "../lib/email/templates";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  /* fine — the variables may already be exported in the shell */
}

const to = arg("to");
const template = arg("template") ?? "reset";

if (!to) {
  console.error("\n✖ Usage: npm run mail:test -- --to <address> [--template reset|invite]\n");
  process.exit(1);
}

async function main() {
  if (!mailerConfigured()) {
    console.error(
      "\n✖ No transport configured.\n" +
        "  Set SMTP_HOST / SMTP_USER / SMTP_PASS (or RESEND_API_KEY) in .env.local.\n",
    );
    process.exit(1);
  }

  const via = process.env.RESEND_API_KEY
    ? "Resend"
    : `${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 465} as ${process.env.SMTP_USER}`;
  console.log(`\nSending via ${via}`);
  console.log(`From: ${mailFrom()}`);
  console.log(`To:   ${to}\n`);

  const link = "https://example.invalid/auth/confirm?token_hash=sample&type=recovery";
  const mail =
    template === "invite"
      ? inviteEmail({ link, invitedBy: "Shivang Gupta", roleLabel: "Sales rep" })
      : passwordResetEmail({ link });

  const result = await sendMail({ ...mail, to: to! });

  if (result.sent) {
    console.log("✓ Accepted by the server. Check the inbox — and the spam folder.\n");
    return;
  }

  console.error(`✖ Not sent: ${result.reason}\n`);
  console.error(
    "  Common causes with Hostinger:\n" +
      "    - SMTP_USER must be the full mailbox address, and SMTP_PASS its own password\n" +
      "    - EMAIL_FROM must be that same mailbox, or the server refuses the From header\n" +
      "    - port 465 needs no STARTTLS; if you set 587 the app switches automatically\n" +
      "    - a brand-new mailbox can take a few minutes before SMTP is enabled\n",
  );
  process.exit(1);
}

main().catch((e: unknown) => {
  console.error(`\n✖ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
