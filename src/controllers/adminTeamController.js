const svc = require('../services/adminTeamService');

// Thin wrapper: run a service call and surface its statusCode on failure.
const handle = (fn) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json(data);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
};

module.exports = {
  modules: handle(() => ({ modules: svc.modules() })),
  list: handle(async () => ({ teams: await svc.listTeams() })),
  get: handle((req) => svc.getTeam(req.params.id)),
  create: handle((req) => svc.createTeam(req.body)),
  update: handle((req) => svc.updateTeam(req.params.id, req.body)),
  remove: handle((req) => svc.deleteTeam(req.params.id)),
  addLevel: handle((req) => svc.addLevel(req.params.id, req.body)),
  updateLevel: handle((req) => svc.updateLevel(req.params.id, req.params.levelId, req.body)),
  deleteLevel: handle((req) => svc.deleteLevel(req.params.id, req.params.levelId)),
  // `submodules` is passed through as-is, including `undefined`. That matters:
  // undefined means "this client didn't send any", which leaves existing
  // overrides alone, whereas `{}` means "there are none", which clears them. A
  // client predating this feature must not wipe overrides just by saving a
  // module grid — see setLevelPermissions.
  setPermissions: handle((req) =>
    svc.setLevelPermissions(
      req.params.id, req.params.levelId,
      req.body.permissions || {},
      req.body.submodules,
    )),
};
