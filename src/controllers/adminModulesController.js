const svc = require('../services/adminModulesService');
const platformSettings = require('../services/platformSettingService');

// Thin HTTP layer over adminModulesService. Errors carry a `statusCode` when
// they come from CustomError; anything else is a genuine 500.
const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(result?.__created ? 201 : 200).json(result?.__created ? result.body : result);
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error('[admin-modules]', error);
    res.status(status).json({ error: error.message });
  }
};

const created = (body) => ({ __created: true, body });

// Builds the five standard REST handlers for a crudFactory service.
const crudHandlers = (service) => ({
  list: handle((req) => service.list(req.query)),
  get: handle((req) => service.getById(req.params.id)),
  create: handle(async (req) => created(await service.create(req.body, req.admin))),
  update: handle((req) => service.update(req.params.id, req.body, req.admin)),
  remove: handle((req) => service.remove(req.params.id, req.admin)),
});

const banners = crudHandlers(svc.banners);
const faqs = crudHandlers(svc.faqs);
const pages = crudHandlers(svc.pages);

// Pages back both the CMS Pages screen and Settings > Legal Pages, which
// requests ?type=legal. crudFactory only filters on `filters`, so lift it
// out of the query string here.
pages.list = handle((req) => {
  const { type, ...rest } = req.query;
  return svc.pages.list({ ...rest, filters: type ? { type } : {} });
});
const featureFlags = crudHandlers(svc.featureFlags);
const messageTemplates = crudHandlers(svc.messageTemplates);
const ipWhitelist = crudHandlers(svc.ipWhitelist);

module.exports = {
  banners, faqs, pages, featureFlags, messageTemplates, ipWhitelist,

  // Platform settings (General/Business/Payments/Notifications/Storage/Maintenance)
  getSettingsGroup: handle((req) => platformSettings.getGroup(req.params.group)),
  updateSettingsGroup: handle((req) => platformSettings.updateGroup(req.params.group, req.body.values || {}, req.admin)),


  // Support Center
  listTickets: handle((req) => svc.listTickets(req.query)),
  getTicket: handle((req) => svc.getTicket(req.params.id)),
  createTicket: handle(async (req) => created(await svc.createTicket(req.body, req.admin))),
  updateTicket: handle((req) => svc.updateTicket(req.params.id, req.body, req.admin)),
  deleteTicket: handle((req) => svc.deleteTicket(req.params.id, req.admin)),
  addTicketMessage: handle(async (req) => created(await svc.addTicketMessage(req.params.id, req.body, req.admin))),

  // Security
  listApiKeys: handle((req) => svc.listApiKeys(req.query)),
  createApiKey: handle(async (req) => created(await svc.createApiKey(req.body, req.admin))),
  revokeApiKey: handle((req) => svc.revokeApiKey(req.params.id, req.admin)),
  listLoginHistory: handle((req) => svc.loginHistory.list(req.query)),

  // Reports / health / integrations
  getReports: handle((req) => svc.getReports(req.query)),
  getSystemHealth: handle(() => svc.getSystemHealth()),
  listWebhookLogs: handle((req) => svc.webhookLogs.list(req.query)),
  getIntegrations: handle(() => svc.getIntegrations()),
};
