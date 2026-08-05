const s = require('../services/campaignService');

const handle = (fn) => async (req, res) => {
  try {
    const result = await fn(req);
    res.status(result?.__created ? 201 : 200).json(result?.__created ? result.body : result);
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    if (status >= 500) console.error('[campaigns]', error);
    res.status(status).json({ error: error.message });
  }
};
const created = (body) => ({ __created: true, body });

module.exports = {
  list:    handle((req) => s.list(req.query)),
  get:     handle(async (req) => {
    const c = await s.get(req.params.id);
    if (!c) { const e = new Error('Campaign not found'); e.statusCode = 404; throw e; }
    return c;
  }),
  create:  handle(async (req) => created(await s.create(req.body, req.admin))),
  update:  handle((req) => s.update(req.params.id, req.body, req.admin)),
  remove:  handle((req) => s.remove(req.params.id, req.admin)),
  send:    handle((req) => s.send(req.params.id, req.admin)),

  // Drives the audience picker in the campaign builder.
  segments: handle(() => s.getSegments()),
  preview:  handle((req) => s.previewAudience(
    req.body.audienceSegment || req.query.audienceSegment,
    req.body.audienceFilters || {},
  )),
};
