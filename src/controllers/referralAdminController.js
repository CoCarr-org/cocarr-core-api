const referralService = require('../services/referralService');

// Admin-facing referral endpoints: campaign configuration, analytics, and
// moderation (block / reverse). Mounted under /admin with the marketing
// permission. Mirrors the handle() pattern used by adminExtraController.
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(result?.__created ? 201 : 200).json(result?.__created ? result.body : result);
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error('[referral-admin]', error);
    res.status(status).json({ error: error.message });
  }
};
const created = (body) => ({ __created: true, body });

module.exports = {
  // Analytics dashboard (PRD section 12).
  analytics: handle(() => referralService.getAnalytics()),

  // Campaign configuration (PRD section 11 — configure rewards / duration /
  // eligibility, enable/disable).
  listCampaigns: handle(() => referralService.listCampaigns()),
  createCampaign: handle(async (req) => created(await referralService.createCampaign(req.body))),
  updateCampaign: handle((req) => referralService.updateCampaign(req.params.id, req.body)),

  // Moderation.
  blockReferral: handle((req) => referralService.blockReferral(req.params.id, req.body?.reason)),
  reverseReward: handle((req) => referralService.reverseReward(req.params.id)),
};
