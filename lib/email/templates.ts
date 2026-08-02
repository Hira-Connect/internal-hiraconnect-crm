import type { Mail } from "./send";

/** Account emails, in the CRM's own navy/gold. Table layout and inline styles —
 *  Outlook still ignores most of a stylesheet. */

const NAVY = "#0f1c33";
const GOLD = "#c9942a";
const BRAND = "#2e6bd6";
const MUTED = "#5b6b86";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell({
  heading,
  body,
  cta,
  link,
  footer,
}: {
  heading: string;
  body: string;
  cta: string;
  link: string;
  footer: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,28,51,.12);">
        <tr><td style="background:${NAVY};padding:20px 28px;">
          <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-.2px;">HIRA <span style="color:${GOLD};">Connect</span></span>
          <span style="color:#8fa2c2;font-size:12px;display:block;margin-top:2px;">CRM &amp; Business Planning Portal</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:19px;line-height:1.3;color:${NAVY};">${heading}</h1>
          <div style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#2b3a55;">${body}</div>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${BRAND};">
            <a href="${link}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${cta}</a>
          </td></tr></table>
          <p style="margin:22px 0 6px;font-size:12px;color:${MUTED};">Or paste this into your browser:</p>
          <p style="margin:0;font-size:12px;word-break:break-all;"><a href="${link}" style="color:${BRAND};">${link}</a></p>
        </td></tr>
        <tr><td style="border-top:1px solid #e3e8f0;padding:16px 28px;font-size:11px;line-height:1.6;color:${MUTED};">
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function inviteEmail({
  link,
  invitedBy,
  roleLabel,
}: {
  link: string;
  invitedBy: string;
  roleLabel: string;
}): Mail & { to: string } {
  const who = escapeHtml(invitedBy);
  const role = escapeHtml(roleLabel);

  return {
    to: "",
    subject: "You have been added to the HIRA Connect CRM",
    html: shell({
      heading: "Set up your CRM account",
      body:
        `<p style="margin:0 0 12px;">${who} has created an account for you on the HIRA Connect CRM ` +
        `with the <b>${role}</b> role.</p>` +
        `<p style="margin:0;">Choose a password to finish setting it up — that is all it takes.</p>`,
      cta: "Set my password",
      link,
      footer:
        "This link works once and expires. If it has already expired, ask an admin to resend the invitation. " +
        "If you were not expecting this email you can ignore it.",
    }),
    text:
      `${invitedBy} has created an account for you on the HIRA Connect CRM (${roleLabel}).\n\n` +
      `Set your password to finish setting it up:\n${link}\n\n` +
      `This link works once and expires. If it has expired, ask an admin to resend the invitation.`,
  };
}

export function passwordResetEmail({ link }: { link: string }): Mail & { to: string } {
  return {
    to: "",
    subject: "Reset your HIRA Connect CRM password",
    html: shell({
      heading: "Reset your password",
      body:
        `<p style="margin:0 0 12px;">Someone asked to reset the password for this address on the ` +
        `HIRA Connect CRM.</p>` +
        `<p style="margin:0;">Use the button below to choose a new one. It works on any device.</p>`,
      cta: "Choose a new password",
      link,
      footer:
        "This link works once and expires within the hour. If you did not ask for it, ignore this email — " +
        "your password stays as it is.",
    }),
    text:
      `Someone asked to reset the password for this address on the HIRA Connect CRM.\n\n` +
      `Choose a new one here:\n${link}\n\n` +
      `This link works once and expires within the hour. If you did not ask for it, ignore this email.`,
  };
}
