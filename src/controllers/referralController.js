const referralService = require('../services/referralService');

// Thin wrappers around referralService. `req.user` is set by authenticateUser
// (same convention as the other user-facing controllers).
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error('[referral]', error);
    res.status(status).json({ error: error.message, code: error.errorCode });
  }
};

const currentUserId = (req) => req.userId;

module.exports = {
  // GET /referral  and  GET /referral/history — the user's referral dashboard.
  overview: handle((req) => referralService.getReferralOverview(currentUserId(req))),

  // POST /referral/validate — check a code before signup. Public: the referee
  // has no account yet. Returns { valid: true, referrerName } or a 4xx error.
  validate: handle(async (req) => {
    const code = req.body?.code || req.body?.referralCode || req.query?.code;
    const { referrer, codeRecord } = await referralService.validateReferralCode(code, currentUserId(req));
    return { valid: true, referralCode: codeRecord.code, referrerName: referrer.name };
  }),

  // GET /referral/status — is the referral programme open? Public, so the
  // signup screen can decide whether to show the "have a referral code?" entry
  // before an account exists.
  status: handle(() => referralService.getProgramStatus()),
};
