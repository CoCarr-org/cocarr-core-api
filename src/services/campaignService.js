const Campaign = require('../models/campaign');
const { logActivity } = require('./activityLogService');
const { SEGMENTS, resolveAudience, previewAudience } = require('./audienceService');
const { sendCampaignEmail } = require('./mailService');
const { sendCampaignSms, isSmsConfigured, isEmailConfigured } = require('./smsService');

const CHANNELS = ['email', 'sms'];

// The shared admin controller maps error.statusCode → HTTP status and only
// console.errors 5xx. Bad input and "not found" must carry one, or a typo'd
// campaign name gets reported to the admin as a server crash.
const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const badRequest = (m) => httpError(m, 400);
const notFound = (m) => httpError(m, 404);

const parseChannels = (value) => String(value || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter((c) => CHANNELS.includes(c));

// Fields a client may set. Counters, status and sentAt are server-owned.
const WRITABLE = [
  'name', 'channels', 'emailSubject', 'emailBody', 'smsBody',
  'audienceSegment', 'audienceFilters', 'scheduledAt',
];

const pick = (body) => WRITABLE.reduce((acc, k) => {
  if (body[k] !== undefined) acc[k] = body[k];
  return acc;
}, {});

function validate(data, { partial = false } = {}) {
  const channels = parseChannels(data.channels);

  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim()) throw badRequest('Campaign name is required');
  }
  if (!partial || data.channels !== undefined) {
    if (!channels.length) throw badRequest('Select at least one channel (email and/or sms)');
  }
  if (channels.includes('email')) {
    if (!data.emailSubject) throw badRequest('Email subject is required for email campaigns');
    if (!data.emailBody) throw badRequest('Email body is required for email campaigns');
  }
  if (channels.includes('sms') && !data.smsBody) {
    throw badRequest('SMS body is required for SMS campaigns');
  }
  if (data.audienceSegment && !SEGMENTS.some((s) => s.key === data.audienceSegment)) {
    throw badRequest(`Unknown audience segment: ${data.audienceSegment}`);
  }
}

async function list({ page = 1, limit = 20, search = '', status } = {}) {
  const { Op } = require('sequelize');
  const where = {};
  if (search) where.name = { [Op.like]: `%${search}%` };
  if (status) where.status = status;

  const offset = (Number(page) - 1) * Number(limit);
  const { count, rows } = await Campaign.findAndCountAll({
    where, limit: Number(limit), offset, order: [['createdAt', 'DESC']],
  });
  return { data: rows, total: count, page: Number(page), limit: Number(limit) };
}

const get = (id) => Campaign.findByPk(id);

async function create(body, admin) {
  const data = pick(body);
  validate(data);
  const campaign = await Campaign.create({
    ...data,
    channels: parseChannels(data.channels).join(','),
    status: data.scheduledAt ? 'scheduled' : 'draft',
    createdByAdminId: admin?.id || null,
    createdByName: admin?.name || null,
  });
  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'create',
    entityType: 'Campaign', entityId: campaign.id, changes: { created: data },
  });
  return campaign;
}

async function update(id, body, admin) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) throw notFound('Campaign not found');
  // A sent campaign is a record of what went out — editing it would make the
  // stored copy disagree with what recipients actually received.
  if (['sending', 'sent', 'partial'].includes(campaign.status)) {
    throw badRequest('A campaign that has already been sent cannot be edited');
  }

  const data = pick(body);
  validate({ ...campaign.toJSON(), ...data }, { partial: true });
  if (data.channels) data.channels = parseChannels(data.channels).join(',');
  await campaign.update(data);

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'update',
    entityType: 'Campaign', entityId: campaign.id, changes: data,
  });
  return campaign;
}

async function remove(id, admin) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) throw notFound('Campaign not found');
  await campaign.destroy();
  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'delete',
    entityType: 'Campaign', entityId: id, changes: { deleted: campaign.toJSON() },
  });
  return { success: true };
}

// {{name}} / {{email}} substitution. Unknown tokens are stripped rather than
// left visible so a typo doesn't ship "{{frist_name}}" to real recipients.
function render(template, user) {
  const values = { name: user.name || 'there', email: user.email || '', phone: user.contactNumber || '' };
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

// Sends sequentially. Deliberately not parallel: both providers rate-limit,
// and a campaign is not latency-sensitive.
async function send(id, admin) {
  const campaign = await Campaign.findByPk(id);
  if (!campaign) throw notFound('Campaign not found');
  if (['sending', 'sent'].includes(campaign.status)) {
    throw badRequest(`Campaign is already ${campaign.status}`);
  }

  const channels = parseChannels(campaign.channels);
  if (channels.includes('email') && !isEmailConfigured()) {
    throw badRequest('Cannot send: SENDGRID_API_KEY is not configured');
  }
  if (channels.includes('sms') && !isSmsConfigured()) {
    throw badRequest('Cannot send: MSG_KEY and MSG91_CAMPAIGN_FLOW_ID must both be configured for SMS');
  }

  const recipients = await resolveAudience(campaign.audienceSegment, campaign.audienceFilters || {});
  await campaign.update({ status: 'sending', recipientCount: recipients.length });

  let emailSent = 0; let emailFailed = 0; let smsSent = 0; let smsFailed = 0;
  let lastError = null;

  for (const user of recipients) {
    if (channels.includes('email') && user.email) {
      try {
        await sendCampaignEmail(user.email, render(campaign.emailSubject, user), render(campaign.emailBody, user));
        emailSent += 1;
      } catch (err) { emailFailed += 1; lastError = err.message; }
    }
    if (channels.includes('sms') && user.contactNumber) {
      try {
        await sendCampaignSms(`${user.countryCode || '91'}${user.contactNumber}`, render(campaign.smsBody, user));
        smsSent += 1;
      } catch (err) { smsFailed += 1; lastError = err.message; }
    }
  }

  const anySent = emailSent + smsSent > 0;
  const anyFailed = emailFailed + smsFailed > 0;
  const status = anySent && anyFailed ? 'partial' : anySent ? 'sent' : 'failed';

  await campaign.update({
    status, sentAt: new Date(), emailSent, emailFailed, smsSent, smsFailed, lastError,
  });
  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'send',
    entityType: 'Campaign', entityId: campaign.id,
    changes: { sent: { status, emailSent, emailFailed, smsSent, smsFailed } },
  });
  return campaign;
}

const getSegments = () => ({
  segments: SEGMENTS,
  transports: { email: isEmailConfigured(), sms: isSmsConfigured() },
});

module.exports = { list, get, create, update, remove, send, getSegments, previewAudience };
