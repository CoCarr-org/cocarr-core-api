const db = require('../configs/db');

// GET /v1/health — liveness + DB reachability. Mirrors the same route on the
// other services, which is what the gateway's /health/services deep check pings.
// Without it that check reported core as ERR_BAD_REQUEST (axios turning the 404
// into an error), which read as "core is down" while core was perfectly fine.
async function health(req, res) {
  let dbOk = false;
  try { await db.authenticate(); dbOk = true; } catch (_) { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    service: 'cocarr-core-api',
    db: dbOk,
    time: new Date().toISOString(),
  });
}

module.exports = { health };
