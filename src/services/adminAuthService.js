const adminAuth = require('../helper/adminAuth');
const { sendCampaignEmail } = require('./mailService');

// Public base URL of the COCARR admin panel (no trailing slash). The
// set/reset-password email links here, to the /set-password page, which reads
// the oobCode from the query string and calls Firebase confirmPasswordReset in
// the browser. Must be the admin panel wired to the SAME Firebase project as
// ADMIN_SERVICE_ACCOUNT, or the oobCode won't verify client-side.
const ADMIN_PANEL_URL = (process.env.ADMIN_PANEL_URL || 'http://localhost:3000').replace(/\/+$/, '');

// Firebase's generatePasswordResetLink returns a full action URL whose `oobCode`
// query param is a one-time code valid for the client SDK's confirmPasswordReset.
// We don't use Firebase's hosted reset UI (and don't need any console action-URL
// customization) — we pull the oobCode out and point it at our /set-password page.
async function buildSetPasswordUrl(email) {
  const link = await adminAuth.generatePasswordResetLink(email);
  const oobCode = new URL(link).searchParams.get('oobCode');
  if (!oobCode) throw new Error('Firebase reset link contained no oobCode');
  const url = `${ADMIN_PANEL_URL}/set-password?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`;
  return { url, oobCode };
}

function emailHtml(url, firstTime) {
  const heading = firstTime ? 'Set your COCARR admin password' : 'Reset your COCARR admin password';
  const lead = firstTime
    ? 'An administrator account has been created for you on the COCARR admin panel. Set a password to sign in.'
    : 'We received a request to reset your COCARR admin password. Choose a new one below.';
  const cta = firstTime ? 'Set password' : 'Reset password';
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">
    <h2 style="color:#111;margin:0 0 12px">${heading}</h2>
    <p style="color:#444;font-size:14px;line-height:1.6;margin:0 0 24px">${lead}</p>
    <p style="margin:0 0 28px">
      <a href="${url}" style="background:#111;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:14px;display:inline-block">${cta}</a>
    </p>
    <p style="color:#777;font-size:12px;line-height:1.6;margin:0 0 16px">If the button doesn't work, copy this link into your browser:<br/>
      <a href="${url}" style="color:#2563eb;word-break:break-all">${url}</a></p>
    <p style="color:#999;font-size:12px;margin:0">This link can be used once and will expire. If you weren't expecting this email, you can safely ignore it.</p>
  </div>`;
}

// Sends the set/reset password email via SendGrid and returns the set-password
// URL (useful for logs and scripts). Throws if the link can't be generated or
// the email can't be sent — the caller decides how to surface that.
async function sendPasswordSetupEmail(email, { firstTime = false } = {}) {
  const { url } = await buildSetPasswordUrl(email);
  const subject = firstTime ? 'Set your COCARR admin password' : 'Reset your COCARR admin password';
  await sendCampaignEmail(email, subject, emailHtml(url, firstTime));
  return url;
}

// The raw set-password URL, kept as a last-resort fallback for the boot flow
// when the email can't be sent (e.g. SendGrid outage) so an operator still has
// a way in from the logs.
async function generateResetLink(email) {
  const { url } = await buildSetPasswordUrl(email);
  return url;
}

module.exports = { buildSetPasswordUrl, sendPasswordSetupEmail, generateResetLink, ADMIN_PANEL_URL };
