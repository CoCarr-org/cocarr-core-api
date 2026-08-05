const x = require('../services/adminExtraService');

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(result?.__created ? 201 : 200).json(result?.__created ? result.body : result);
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error('[admin-extra]', error);
    res.status(status).json({ error: error.message });
  }
};
const created = (body) => ({ __created: true, body });

const crud = (service) => ({
  list: handle((req) => service.list(req.query)),
  get: handle((req) => service.getById(req.params.id)),
  create: handle(async (req) => created(await service.create(req.body, req.admin))),
  update: handle((req) => service.update(req.params.id, req.body, req.admin)),
  remove: handle((req) => service.remove(req.params.id, req.admin)),
});

module.exports = {
  disputes: crud(x.disputes),
  media: crud(x.media),
  announcements: crud(x.announcements),
  pushCampaigns: crud(x.pushCampaigns),
  sendPushCampaign: handle((req) => x.sendPushCampaign(req.params.id, req.admin)),
  listApiLogs: handle((req) => x.apiLogs.list(req.query)),

  listRefunds: handle((req) => x.listRefunds(req.query)),
  listPayouts: handle((req) => x.listPayouts(req.query)),
  listInvoices: handle((req) => x.listInvoices(req.query)),
  listReferrals: handle((req) => x.listReferrals(req.query)),
  listUserReferrals: handle((req) => x.listUserReferrals(req.query)),
  getUserReferralDetail: handle((req) => x.getUserReferralDetail(req.params.userId)),
  listFeedback: handle((req) => x.listFeedback(req.query)),
  listVehiclePricing: handle((req) => x.listVehiclePricing(req.query)),
  listVehicleDocuments: handle((req) => x.listVehicleDocuments(req.query)),
  listHostDocuments: handle((req) => x.listHostDocuments(req.query)),

  getSystemAlerts: handle(() => x.getSystemAlerts()),
  getOperationalReport: handle((req) => x.getOperationalReport(req.query)),
  getCustomerReport: handle((req) => x.getCustomerReport(req.query)),
  getBackgroundJobs: handle(() => x.getBackgroundJobs()),
  getExportTargets: handle(() => x.getExportTargets()),
};
