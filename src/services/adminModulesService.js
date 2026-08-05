const crypto = require('crypto');
const os = require('os');
const { Op, fn, col, literal } = require('sequelize');
const db = require('../configs/db');
const { CustomError } = require('../middlewares/error');
const { createCrudService } = require('./crudFactory');
const { logActivity } = require('./activityLogService');

const Ticket = require('../models/ticket');
const TicketMessage = require('../models/ticketMessage');
const Banner = require('../models/banner');
const Faq = require('../models/faq');
const Page = require('../models/page');
const FeatureFlag = require('../models/featureFlag');
const ApiKey = require('../models/apiKey');
const IpWhitelist = require('../models/ipWhitelist');
const LoginHistory = require('../models/loginHistory');
const WebhookLog = require('../models/webhookLog');
const MessageTemplate = require('../models/messageTemplate');
const Booking = require('../models/booking');
const Vehicle = require('../models/vehicle');
const User = require('../models/user');

// ── Plain CRUD modules ──────────────────────────────────────────────────
const banners = createCrudService({
  model: Banner, entityType: 'Banner', searchable: ['title', 'placement'],
  defaultSort: 'sortOrder',
  allowed: ['title', 'imageUrl', 'linkUrl', 'placement', 'sortOrder', 'isActive', 'startsAt', 'endsAt'],
});

const faqs = createCrudService({
  model: Faq, entityType: 'FAQ', searchable: ['question', 'answer', 'category'],
  defaultSort: 'sortOrder',
  allowed: ['question', 'answer', 'category', 'audience', 'sortOrder', 'isActive'],
});

const pages = createCrudService({
  model: Page, entityType: 'Page', searchable: ['title', 'slug'],
  allowed: ['slug', 'title', 'content', 'type', 'isPublished', 'publishedAt'],
});

const featureFlags = createCrudService({
  model: FeatureFlag, entityType: 'FeatureFlag', searchable: ['key', 'label'],
  defaultSort: 'key',
  allowed: ['key', 'label', 'description', 'isEnabled'],
});

const messageTemplates = createCrudService({
  model: MessageTemplate, entityType: 'MessageTemplate', searchable: ['key', 'name', 'subject'],
  defaultSort: 'name',
  allowed: ['key', 'name', 'channel', 'subject', 'body', 'variables', 'isActive'],
});

const ipWhitelist = createCrudService({
  model: IpWhitelist, entityType: 'IpWhitelist', searchable: ['label', 'ipAddress'],
  allowed: ['label', 'ipAddress', 'isActive'],
});

const webhookLogs = createCrudService({
  model: WebhookLog, entityType: 'WebhookLog', searchable: ['source', 'event'],
});

const loginHistory = createCrudService({
  model: LoginHistory, entityType: 'LoginHistory', searchable: ['adminEmail', 'adminName', 'ipAddress'],
});

// ── Support Center ──────────────────────────────────────────────────────
// Tickets need more than plain CRUD: a human-readable number, a message
// thread, and status transitions that stamp resolvedAt.
const ticketsCrud = createCrudService({
  model: Ticket, entityType: 'Ticket', searchable: ['ticketNumber', 'subject', 'category'],
  allowed: ['subject', 'description', 'category', 'status', 'priority', 'userId', 'bookingId'],
});

async function listTickets(params) {
  const filters = {};
  if (params.status) filters.status = params.status;
  if (params.priority) filters.priority = params.priority;
  return ticketsCrud.list({ ...params, filters });
}

async function getTicket(id) {
  const ticket = await ticketsCrud.getById(id);
  const messages = await TicketMessage.findAll({
    where: { ticketId: id },
    order: [['createdAt', 'ASC']],
  });
  return { ticket, messages };
}

async function createTicket(body, actingAdmin) {
  // Short, human-quotable reference — random rather than sequential so it
  // doesn't leak ticket volume.
  const ticketNumber = `TKT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const ticket = await Ticket.create({
    ticketNumber,
    subject: body.subject,
    description: body.description,
    category: body.category,
    priority: body.priority || 'medium',
    userId: body.userId || null,
    bookingId: body.bookingId || null,
    status: 'open',
  });

  if (body.description) {
    await TicketMessage.create({
      ticketId: ticket.id,
      authorType: 'admin',
      authorId: actingAdmin?.id,
      authorName: actingAdmin?.name,
      message: body.description,
    });
  }

  await logActivity({
    adminId: actingAdmin?.id, adminName: actingAdmin?.name,
    action: 'create', entityType: 'Ticket', entityId: ticket.id,
    changes: { created: ticket.toJSON() },
  });
  return ticket;
}

async function updateTicket(id, body, actingAdmin) {
  const ticket = await ticketsCrud.getById(id);
  const before = ticket.toJSON();

  const fields = {};
  ['subject', 'description', 'category', 'status', 'priority', 'assignedToAdminId', 'assignedToName']
    .forEach((f) => { if (body[f] !== undefined) fields[f] = body[f]; });

  // Stamp/clear resolvedAt so "when was this closed" doesn't need a log dig.
  if (fields.status && fields.status !== before.status) {
    fields.resolvedAt = ['resolved', 'closed'].includes(fields.status) ? new Date() : null;
  }

  await ticket.update(fields);

  const changed = {};
  Object.keys(fields).forEach((k) => {
    if (String(before[k]) !== String(fields[k])) changed[k] = { from: before[k], to: fields[k] };
  });
  if (Object.keys(changed).length) {
    await logActivity({
      adminId: actingAdmin?.id, adminName: actingAdmin?.name,
      action: 'update', entityType: 'Ticket', entityId: id, changes: changed,
    });
  }
  return ticket;
}

async function addTicketMessage(id, body, actingAdmin) {
  await ticketsCrud.getById(id); // 404s if the ticket doesn't exist
  const message = await TicketMessage.create({
    ticketId: id,
    authorType: 'admin',
    authorId: actingAdmin?.id,
    authorName: actingAdmin?.name,
    message: body.message,
    isInternalNote: !!body.isInternalNote,
  });
  // A reply moves an open ticket to pending (awaiting customer).
  const ticket = await Ticket.findByPk(id);
  if (ticket && ticket.status === 'open' && !body.isInternalNote) {
    await ticket.update({ status: 'pending' });
  }
  return message;
}

// ── API Keys ────────────────────────────────────────────────────────────
// The plaintext key is returned exactly once and never stored.
const hashKey = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

async function listApiKeys(params) {
  const { data, totalCount } = await createCrudService({
    model: ApiKey, entityType: 'ApiKey', searchable: ['name', 'prefix'],
  }).list(params);
  // Defensive: never let the hash leave the server.
  return { data: data.map((k) => { const j = k.toJSON(); delete j.hashedKey; return j; }), totalCount };
}

async function createApiKey(body, actingAdmin) {
  const raw = `ck_${crypto.randomBytes(24).toString('hex')}`;
  const key = await ApiKey.create({
    name: body.name,
    prefix: raw.slice(0, 10),
    hashedKey: hashKey(raw),
    scopes: body.scopes || null,
    createdByAdminId: actingAdmin?.id,
    createdByName: actingAdmin?.name,
  });

  await logActivity({
    adminId: actingAdmin?.id, adminName: actingAdmin?.name,
    action: 'create', entityType: 'ApiKey', entityId: key.id,
    changes: { created: { name: key.name, prefix: key.prefix } },
  });

  const json = key.toJSON();
  delete json.hashedKey;
  return { ...json, key: raw, warning: 'Copy this key now — it cannot be retrieved again.' };
}

async function revokeApiKey(id, actingAdmin) {
  const key = await ApiKey.findByPk(id);
  if (!key) throw new CustomError('API key not found', 404);
  await key.update({ revokedAt: new Date() });
  await logActivity({
    adminId: actingAdmin?.id, adminName: actingAdmin?.name,
    action: 'update', entityType: 'ApiKey', entityId: id,
    changes: { revoked: { from: null, to: key.revokedAt } },
  });
  const json = key.toJSON();
  delete json.hashedKey;
  return json;
}

// ── Reports & Analytics ─────────────────────────────────────────────────
// Aggregations over existing booking/vehicle/user tables — no new storage.
async function getReports({ from, to } = {}) {
  const where = {};
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt[Op.gte] = new Date(from);
    if (to) where.createdAt[Op.lte] = new Date(to);
  }

  const [totalBookings, finishedBookings, cancelledBookings, totalUsers, totalVehicles] = await Promise.all([
    Booking.count({ where }),
    Booking.count({ where: { ...where, status: 'finished' } }),
    Booking.count({ where: { ...where, status: 'cancelled' } }),
    User.count(),
    Vehicle.count(),
  ]);

  const revenueRow = await Booking.findOne({
    where: { ...where, status: ['finished', 'ongoing'] },
    attributes: [[fn('SUM', col('totalAmount')), 'revenue']],
    raw: true,
  });
  const revenue = Number(revenueRow?.revenue || 0);

  // Bookings + revenue per day for charting.
  const byDay = await Booking.findAll({
    where,
    attributes: [
      [fn('DATE', col('createdAt')), 'day'],
      [fn('COUNT', col('id')), 'bookings'],
      [fn('SUM', col('totalAmount')), 'revenue'],
    ],
    group: [literal('DATE(createdAt)')],
    order: [[literal('DATE(createdAt)'), 'ASC']],
    raw: true,
  });

  const statusBreakdown = await Booking.findAll({
    where,
    attributes: ['status', [fn('COUNT', col('id')), 'count']],
    group: ['status'],
    raw: true,
  });

  return {
    summary: {
      totalBookings,
      finishedBookings,
      cancelledBookings,
      revenue,
      totalUsers,
      totalVehicles,
      // Share of all vehicles that were booked at least once in range.
      completionRate: totalBookings ? Math.round((finishedBookings / totalBookings) * 100) : 0,
    },
    byDay,
    statusBreakdown,
  };
}

// ── System Health ───────────────────────────────────────────────────────
async function getSystemHealth() {
  let database = { connected: false, error: null };
  try {
    await db.authenticate();
    database.connected = true;
  } catch (error) {
    database.error = error.message;
  }

  const [recentWebhooks, failedWebhooks] = await Promise.all([
    WebhookLog.count(),
    WebhookLog.count({ where: { succeeded: false } }),
  ]);

  return {
    status: database.connected ? 'healthy' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()}`,
    memory: {
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      systemFreeMb: Math.round(os.freemem() / 1024 / 1024),
      systemTotalMb: Math.round(os.totalmem() / 1024 / 1024),
    },
    database,
    webhooks: { total: recentWebhooks, failed: failedWebhooks },
    // The only scheduled job in the codebase today.
    jobs: [{ name: 'Payout scheduler', configured: true }],
  };
}

// ── Integrations ────────────────────────────────────────────────────────
// Reports whether each integration is CONFIGURED (env var present). It never
// returns the values themselves — only whether something is set.
function getIntegrations() {
  // Env var names must match what the code ACTUALLY reads, not what they're
  // conventionally called — Razorpay here is PG_KEY/PG_SEC (see
  // helper/payment.js), and storage accepts several aliases (imageService.js).
  const all = (vars) => vars.every((v) => !!process.env[v]);
  const any = (vars) => vars.some((v) => !!process.env[v]);
  return {
    integrations: [
      { key: 'razorpay', name: 'Razorpay (Payments)', configured: all(['PG_KEY', 'PG_SEC']), envVars: ['PG_KEY', 'PG_SEC'] },
      { key: 'firebaseUser', name: 'Firebase — user project', configured: all(['USER_SERVICE_ACCOUNT']), envVars: ['USER_SERVICE_ACCOUNT'] },
      { key: 'firebaseAdmin', name: 'Firebase — admin project', configured: all(['ADMIN_SERVICE_ACCOUNT']), envVars: ['ADMIN_SERVICE_ACCOUNT'] },
      { key: 'googleMaps', name: 'Google Maps', configured: all(['GOOGLE_API_KEY']), envVars: ['GOOGLE_API_KEY'] },
      { key: 'cashfreeKyc', name: 'Cashfree (Aadhaar KYC)', configured: all(['KYC_URL', 'KYC_ID', 'KYC_SECRET']), envVars: ['KYC_URL', 'KYC_ID', 'KYC_SECRET'] },
      { key: 'storage', name: 'Object storage (Tigris)', configured: any(['S3_BUCKET', 'BUCKET_NAME', 'AWS_BUCKET', 'STORAGE_BUCKET']), envVars: ['S3_BUCKET / BUCKET_NAME / AWS_BUCKET / STORAGE_BUCKET'] },
      { key: 'database', name: 'MySQL database', configured: all(['DB_NAME', 'DB_USER', 'DB_HOST']), envVars: ['DB_NAME', 'DB_USER', 'DB_HOST'] },
    ],
  };
}

module.exports = {
  banners, faqs, pages, featureFlags, messageTemplates, ipWhitelist, webhookLogs, loginHistory,
  listTickets, getTicket, createTicket, updateTicket, addTicketMessage, deleteTicket: ticketsCrud.remove,
  listApiKeys, createApiKey, revokeApiKey,
  getReports, getSystemHealth, getIntegrations,
};
