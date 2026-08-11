// WHY A SERVICE THAT CANNOT REACH ITS DATABASE MUST SAY SO IN ONE LINE.
//
// Topology: ONE MySQL instance, ONE SCHEMA PER SERVICE (cocarr_core,
// cocarr_iam, cocarr_workspace, …). Each service owns its schema and must never
// touch another's — see docs/DATABASE.md.
//
// The failure this exists for: `DB_NAME` naming a schema that does not exist.
// MySQL does not create it; it refuses every query with `Unknown database
// 'cocarr_core'`. The service connects "fine" at the pool level, boots, reports
// healthy, and then 400s every single request. The first symptom is a support
// message about empty lists, and the cause is four layers away from it.
//
// Worse, an EMPTY-but-present schema looks almost identical from outside,
// because the boot seeders refill default cities and brands — so the platform
// answers 200 with plausible reference data and zero real rows. That is not
// hypothetical: it is exactly how a wrong DB_NAME was mistaken for a broken
// query for most of a day.
//
// So: classify the failure precisely, say what to run, and keep serving /health
// so the misconfiguration stays diagnosable. Refusing to boot would hide the
// reason — the same rule the gateway applies to a missing Firebase credential.
const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER'];

// Distinguishing these matters because the remedies are completely different,
// and the raw driver error is easy to skim past.
function classify(error) {
  const code = error?.parent?.code || error?.original?.code || error?.code;
  const name = process.env.DB_NAME;
  switch (code) {
    case 'ER_BAD_DB_ERROR':
      return {
        cause: `The schema '${name}' does not exist on ${process.env.DB_HOST}.`,
        fix: 'node scripts/ensureDatabase.js --confirm   (then the schema/seed scripts)',
      };
    case 'ER_ACCESS_DENIED_ERROR':
      return {
        cause: `MySQL refused DB_USER='${process.env.DB_USER}' for '${name}'.`,
        // Under this topology each service has its own user granted only its own
        // schema, so a denial here is often a service pointed at the wrong one.
        fix: "Check DB_USER/DB_PASS, and that the user is GRANTed on this schema only.",
      };
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { cause: `DB_HOST='${process.env.DB_HOST}' does not resolve.`, fix: 'Check DB_HOST.' };
    case 'ECONNREFUSED':
      return {
        cause: `Nothing accepted a connection at ${process.env.DB_HOST}:${process.env.DB_PORT || 3306}.`,
        fix: 'Check the instance is running and DB_PORT is right.',
      };
    case 'ETIMEDOUT':
    case 'PROTOCOL_SEQUENCE_TIMEOUT':
      return {
        cause: `Timed out reaching ${process.env.DB_HOST}.`,
        // Railway's private network is IPv6-only; a database reachable publicly
        // and not privately times out exactly like this.
        fix: 'Check network reachability — on Railway the private network is IPv6-only.',
      };
    default:
      return { cause: error?.parent?.sqlMessage || error.message, fix: null };
  }
}

// Never throws. Returns { ok, cause, fix } and logs a banner nobody scrolls
// past. The caller decides what to do; every service so far keeps serving
// /health, which reports db:false and fails the deploy healthcheck — so a
// broken deploy is rejected rather than silently replacing a working one.
async function preflight(db, log = console) {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    log.error('!!! DATABASE NOT CONFIGURED !!!');
    log.error(`  missing: ${missing.join(', ')}`);
    log.error('  Every query will fail until these are set on this service.');
    return { ok: false, cause: `missing env: ${missing.join(', ')}`, fix: null };
  }

  try {
    await db.authenticate();
    log.info(`Database ok — ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);
    return { ok: true };
  } catch (error) {
    const { cause, fix } = classify(error);
    log.error('!!! DATABASE UNREACHABLE — EVERY QUERY WILL FAIL !!!');
    log.error(`  ${cause}`);
    if (fix) log.error(`  fix: ${fix}`);
    log.error(`  DB_NAME=${process.env.DB_NAME} DB_HOST=${process.env.DB_HOST} DB_USER=${process.env.DB_USER}`);
    return { ok: false, cause, fix };
  }
}

module.exports = { preflight, classify, REQUIRED };
