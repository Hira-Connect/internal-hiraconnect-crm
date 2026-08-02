import "server-only";

/** Outgoing mail for account emails (invites, password resets).
 *
 *  The CRM sends these itself rather than letting Supabase send them. That buys
 *  three things the built-in mailer cannot give us:
 *    - links that point straight at this app, so they never depend on the
 *      Supabase redirect allow-list (a mis-set Site URL used to send every reset
 *      to http://localhost:3000)
 *    - templates that live in this repo instead of a dashboard text box
 *    - no shared-mailer rate limit
 *
 *  Two transports, whichever is configured — Resend if `RESEND_API_KEY` is set,
 *  otherwise SMTP if `SMTP_HOST` is. With neither, sending fails cleanly and the
 *  caller falls back to showing the link so an admin can pass it on by hand.
 */

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailResult = { sent: true } | { sent: false; reason: string };

export const MAIL_NOT_CONFIGURED =
  "No email transport is configured — set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS.";

export function mailerConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

/** What the server thinks it is configured with — no secrets, safe to render.
 *  Exists because the deployment's environment is the usual reason mail does not
 *  arrive, and reading it from inside the app beats guessing at a dashboard. */
export interface MailConfig {
  transport: "resend" | "smtp" | "none";
  detail: string;
  from: string;
  /** SMTP without a password almost always means a half-filled environment. */
  secretSet: boolean;
}

export function mailConfig(): MailConfig {
  if (process.env.RESEND_API_KEY) {
    return {
      transport: "resend",
      detail: "Resend API",
      from: mailFrom(),
      secretSet: true,
    };
  }
  if (process.env.SMTP_HOST) {
    const user = process.env.SMTP_USER || "(no username — sending unauthenticated)";
    return {
      transport: "smtp",
      detail: `${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 465} as ${user}`,
      from: mailFrom(),
      secretSet: Boolean(process.env.SMTP_PASS),
    };
  }
  return { transport: "none", detail: "nothing configured", from: mailFrom(), secretSet: false };
}

/** `Name <address>` used as the From header.
 *
 *  Falls back to the SMTP mailbox itself, because Hostinger (like most hosts)
 *  rejects a From that is not the account you authenticated as — silently
 *  defaulting to a hard-coded address would just produce bounces. */
export function mailFrom(): string {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.SMTP_USER) return `HIRA Connect <${process.env.SMTP_USER}>`;
  return "HIRA Connect <no-reply@hiraconnect.com>";
}

export async function sendMail(mail: Mail): Promise<MailResult> {
  try {
    if (process.env.RESEND_API_KEY) return await sendWithResend(mail);
    if (process.env.SMTP_HOST) return await sendWithSmtp(mail);
    return { sent: false, reason: MAIL_NOT_CONFIGURED };
  } catch (e) {
    const reason = describeMailError(e);
    // Always logged, not just in development: when mail fails on a deployment
    // the server log is the only place anyone can see why.
    console.error(`[email] send to ${mail.to} failed: ${reason}`);
    return { sent: false, reason };
  }
}

/** nodemailer hides the useful part in `code` and the server's own `response`.
 *  Surfacing both turns "it didn't work" into something actionable. */
function describeMailError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);

  const err = e as Error & { code?: string; response?: string; command?: string };
  const parts = [err.message];
  if (err.response && !err.message.includes(err.response)) parts.push(err.response);

  switch (err.code) {
    case "EAUTH":
      parts.push("SMTP_USER must be the full mailbox address and SMTP_PASS that mailbox's own password.");
      break;
    case "ECONNECTION":
    case "ESOCKET":
      parts.push("Could not open the connection — check SMTP_HOST and SMTP_PORT (465 for SSL, 587 for TLS).");
      break;
    case "ETIMEDOUT":
    case "ECONNRESET":
      parts.push("The mail server did not answer in time.");
      break;
    case "EENVELOPE":
      parts.push("The server refused the From or To address — EMAIL_FROM must be the mailbox you signed in as.");
      break;
    default:
      if (err.code) parts.push(`(${err.code})`);
  }
  return parts.join(" ");
}

async function sendWithResend(mail: Mail): Promise<MailResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    }),
  });

  if (res.ok) return { sent: true };

  // Resend returns { name, message } on failure; fall back to the status line.
  const body = (await res.json().catch(() => null)) as { message?: string } | null;
  return { sent: false, reason: body?.message ?? `Resend responded ${res.status}` };
}

async function sendWithSmtp(mail: Mail): Promise<MailResult> {
  // Imported lazily so a Resend-only deployment never loads it.
  const nodemailer = (await import("nodemailer")).default;

  const port = Number(process.env.SMTP_PORT ?? 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 is implicit TLS; 587 upgrades with STARTTLS
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
    // A serverless function is billed by the second and Hostinger's SMTP can be
    // slow to answer; fail in a way the UI can report rather than hanging.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  await transport.sendMail({
    from: mailFrom(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  return { sent: true };
}
