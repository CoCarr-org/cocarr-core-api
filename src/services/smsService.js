const axios = require('axios');

// Campaign SMS via MSG91.
//
// NOTE: the existing OTP flow uses MSG91's /otp endpoint, which only sends
// OTP-template messages and cannot carry campaign copy. This uses the flow
// API instead, which requires a DLT-approved template registered in the
// MSG91 dashboard — Indian regulation does not allow arbitrary promotional
// text. `MSG91_CAMPAIGN_FLOW_ID` must hold that template's flow id, and the
// template needs a variable (default `##body##`) for the message text.
async function sendCampaignSms(mobile, body) {
  const authkey = process.env.MSG_KEY;
  const flowId = process.env.MSG91_CAMPAIGN_FLOW_ID;

  if (!authkey) throw new Error('MSG_KEY is not configured');
  if (!flowId) {
    throw new Error(
      'MSG91_CAMPAIGN_FLOW_ID is not configured. Campaign SMS needs a DLT-approved ' +
      'MSG91 flow/template — the OTP template cannot be reused for marketing copy.'
    );
  }

  const to = String(mobile).replace(/^\+/, '');
  const res = await axios.post(
    'https://control.msg91.com/api/v5/flow/',
    { template_id: flowId, recipients: [{ mobiles: to, body }] },
    { headers: { authkey, 'Content-Type': 'application/json' } }
  );

  if (res.data?.type === 'error') throw new Error(res.data?.message || 'MSG91 rejected the message');
  return res.data;
}

const isSmsConfigured = () => !!(process.env.MSG_KEY && process.env.MSG91_CAMPAIGN_FLOW_ID);
const isEmailConfigured = () => !!process.env.SENDGRID_API_KEY;

module.exports = { sendCampaignSms, isSmsConfigured, isEmailConfigured };
