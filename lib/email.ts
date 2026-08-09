// Email delivery. Every outbound email goes through this module so the provider
// is swappable in one place. Sending is wired to Resend but stays fully optional:
// with no RESEND_API_KEY / EMAIL_FROM configured, sends are logged no-ops and
// callers fall back to surfacing the invite link in the UI — so the app builds
// and runs identically without an email account, and lights up the moment the
// two env vars exist (plus a verified sending domain on the Resend side).
//
//   RESEND_API_KEY=re_...                     # https://resend.com/api-keys
//   EMAIL_FROM="Verbatim <invites@verbatimintel.com>"   # must be a verified domain

import { Resend } from 'resend'

const apiKey = process.env.RESEND_API_KEY
const from = process.env.EMAIL_FROM
// Instantiated once; null when unconfigured so we cleanly no-op instead of throwing.
const resend = apiKey ? new Resend(apiKey) : null

export interface InviteEmail {
  to: string
  inviteUrl: string
  companyName: string
  invitedByEmail?: string
}

// Returns whether the email was actually dispatched. False (no provider wired, or
// a send failure) tells callers to fall back to showing the invite link in the UI —
// a failed send must never break invite creation, so errors are swallowed to false.
export async function sendInviteEmail(invite: InviteEmail): Promise<{ sent: boolean }> {
  if (!resend || !from) {
    console.log(
      `[email:stub] invite for "${invite.companyName || 'your team'}" -> ${invite.to}: ${invite.inviteUrl}`,
    )
    return { sent: false }
  }

  const workspace = invite.companyName?.trim()
  const inviter = invite.invitedByEmail ? `${invite.invitedByEmail} ` : ''
  const subject = workspace
    ? `You're invited to ${workspace} on Verbatim`
    : `You're invited to a Verbatim workspace`

  try {
    const { error } = await resend.emails.send({
      from,
      to: invite.to,
      subject,
      text: inviteText(invite, workspace, inviter),
      html: inviteHtml(invite, workspace, inviter),
    })
    if (error) {
      console.error(`[email] invite send failed -> ${invite.to}:`, error)
      return { sent: false }
    }
    return { sent: true }
  } catch (err) {
    console.error(`[email] invite send threw -> ${invite.to}:`, err)
    return { sent: false }
  }
}

// Operator alert (run failures). Goes to ALERT_EMAIL — Heinrich, never a
// client. Same optional posture as everything else here: unset var or no
// provider = logged no-op, and a failed alert send must never mask the
// failure it reports, so errors are swallowed to false.
export async function sendAlertEmail(subject: string, text: string): Promise<{ sent: boolean }> {
  const to = process.env.ALERT_EMAIL
  if (!resend || !from || !to) {
    console.log(`[email:stub] alert: ${subject}`)
    return { sent: false }
  }
  try {
    const { error } = await resend.emails.send({ from, to, subject, text })
    if (error) {
      console.error(`[email] alert send failed:`, error)
      return { sent: false }
    }
    return { sent: true }
  } catch (err) {
    console.error(`[email] alert send threw:`, err)
    return { sent: false }
  }
}

export interface ReportEmail {
  to: string[]
  subject: string
  html: string
  text: string
}

// Sends a periodic (weekly/monthly) report to the configured recipients. Like
// invites, this no-ops (returns sent:false) when Resend isn't configured or there
// are no recipients — so report generation + persistence still succeed without an
// email provider, and the report is simply stored for in-app viewing instead.
export async function sendReportEmail(report: ReportEmail): Promise<{ sent: boolean }> {
  if (!resend || !from || report.to.length === 0) {
    console.log(
      `[email:stub] report "${report.subject}" -> ${report.to.join(', ') || '(no recipients)'}`,
    )
    return { sent: false }
  }

  try {
    const { error } = await resend.emails.send({
      from,
      to: report.to,
      subject: report.subject,
      text: report.text,
      html: report.html,
    })
    if (error) {
      console.error('[email] report send failed:', error)
      return { sent: false }
    }
    return { sent: true }
  } catch (err) {
    console.error('[email] report send threw:', err)
    return { sent: false }
  }
}

function inviteText(invite: InviteEmail, workspace: string | undefined, inviter: string): string {
  const where = workspace ? `the ${workspace} workspace` : 'a workspace'
  return [
    `${inviter}invited you to join ${where} on Verbatim.`,
    ``,
    `Accept your invite:`,
    invite.inviteUrl,
    ``,
    `This link expires in 7 days. If you weren't expecting this, you can ignore it.`,
  ].join('\n')
}

function inviteHtml(invite: InviteEmail, workspace: string | undefined, inviter: string): string {
  const where = workspace
    ? `the <strong>${escapeHtml(workspace)}</strong> workspace`
    : 'a workspace'
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
          <tr><td>
            <p style="margin:0 0 16px;font-size:16px;line-height:1.5">
              ${escapeHtml(inviter)}invited you to join ${where} on <strong>Verbatim</strong>.
            </p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#475569">
              Verbatim is a consumer-intelligence platform — sign in to see your team's dashboards.
            </p>
            <a href="${invite.inviteUrl}"
               style="display:inline-block;background:#1E40AF;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px">
              Accept invite
            </a>
            <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;word-break:break-all">
              Or paste this link into your browser:<br>${invite.inviteUrl}
            </p>
            <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">
              This link expires in 7 days. If you weren't expecting this, you can ignore it.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
