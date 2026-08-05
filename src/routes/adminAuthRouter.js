// Public admin auth routes — NO authenticateAdmin, because the admin is not
// signed in when they've forgotten their password.
//
// Mounted at /admin BEFORE adminModulesRouter and adminRouter in rootRouter.js.
// It only declares the literal /forgot-password path, so every other /admin/*
// request falls straight through to the routers behind it.
const express = require('express');
const router = express.Router();
const { sendPasswordSetupEmail } = require('../services/adminAuthService');

// POST /admin/forgot-password  { email }
//
// Emails a link to the admin panel's /set-password page carrying a one-time
// oobCode. Always responds 200 with a generic message so the endpoint can't be
// used to enumerate which emails are admins — the only non-200 is a genuine
// send failure.
router.post('/forgot-password', async (req, res) => {
  const email = (req.body && req.body.email ? String(req.body.email) : '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    await sendPasswordSetupEmail(email, { firstTime: false });
  } catch (error) {
    // No Firebase account for this email — mask it (don't reveal existence).
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-email') {
      console.warn(`[admin-forgot-password] no admin Firebase user for ${email} (${error.code})`);
    } else {
      // Genuine failure (e.g. SendGrid outage) — surface it so the UI can ask
      // the user to retry rather than falsely claim the email was sent.
      console.error('[admin-forgot-password] failed:', error.message);
      return res.status(500).json({ error: 'Could not send the reset email. Please try again later.' });
    }
  }

  return res.json({
    message: 'If that email belongs to an admin account, a password reset link has been sent.',
  });
});

module.exports = router;
