// SCHEMA CHANGES ARE VERSIONED FILES, APPLIED ONCE, IN ORDER, RECORDED.
//
// This replaces `db.sync({ alter: true })`, which is not a migration system and
// loses data by design:
//
//   - It DROPS any column no longer declared on a model, with its contents. A
//     rename is indistinguishable from "old column gone, new column added", so
//     renaming a field silently destroys every value in it.
//   - One bad foreign key or ENUM change aborts the WHOLE pass, and every model
//     after the failure point silently never gets its table. That is how
//     `settlements` and later `roleAssignments` went missing while the service
//     reported healthy.
//   - Repeated alters accumulate duplicate indexes until a table trips MySQL's
//     64-key limit, after which every future sync fails.
//   - It runs on every boot, so deploy and schema change are the same
//     irreversible act. Roll the code back and the schema does not follow.
//
// Migrations fix all four: nothing happens implicitly, a failure stops at the
// failing migration, indexes are created once by name, and every change is
// reviewed in a PR with a `down()`.
//
// WHY UMZUG AND NOT sequelize-cli. Umzug is a library, so migrations run inside
// the service's own boot/CLI using the sequelize instance already configured in
// src/configs/db.js — no parallel config.json that can disagree with it. (The
// one sequelize-cli attempt in this platform produced a single migration file
// in 2024 that nothing ever ran.)
const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const db = require('../configs/db');
const Logger = require('../helper/logger');

// Applied migrations are recorded in THIS service's own schema, alongside its
// tables — one instance, one schema per service, so each service's history is
// isolated from the others.
const STORAGE_TABLE = 'schemaMigrations';

function buildMigrator({ log = Logger } = {}) {
  return new Umzug({
    migrations: {
      glob: path.join(__dirname, '../../migrations/*.js'),
      // Every migration receives the QueryInterface and Sequelize DataTypes,
      // never a model. Models describe the CURRENT shape; a migration must
      // describe the shape at ITS point in history, or replaying an old
      // migration against a new codebase does the wrong thing.
      resolve: ({ name, path: filePath, context }) => {
        const migration = require(filePath);
        return {
          name,
          up: async () => migration.up(context, db.constructor),
          down: async () => (migration.down
            ? migration.down(context, db.constructor)
            : Promise.reject(new Error(`Migration ${name} has no down() — it cannot be rolled back.`))),
        };
      },
    },
    context: db.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize: db, tableName: STORAGE_TABLE }),
    logger: {
      info: (m) => log.info(`[migrate] ${m.event || ''} ${m.name || JSON.stringify(m)}`.trim()),
      warn: (m) => log.error(`[migrate] ${JSON.stringify(m)}`),
      error: (m) => log.error(`[migrate] ${JSON.stringify(m)}`),
      debug: () => {},
    },
  });
}

// Run everything pending. Returns the names applied.
//
// THROWS on failure, and callers at boot must NOT swallow it. A service running
// new code against a schema that failed to migrate is the worst of both worlds:
// it looks healthy and writes to columns that may not exist. Failing the deploy
// keeps the previous, working container serving.
async function migrateUp({ log = Logger } = {}) {
  const umzug = buildMigrator({ log });
  const pending = await umzug.pending();
  if (!pending.length) {
    log.info('[migrate] schema up to date — no pending migrations.');
    return [];
  }
  log.info(`[migrate] applying ${pending.length}: ${pending.map((p) => p.name).join(', ')}`);
  const applied = await umzug.up();
  return applied.map((m) => m.name);
}

async function status() {
  const umzug = buildMigrator();
  const [executed, pending] = await Promise.all([umzug.executed(), umzug.pending()]);
  return {
    executed: executed.map((m) => m.name),
    pending: pending.map((m) => m.name),
  };
}

module.exports = { buildMigrator, migrateUp, status, STORAGE_TABLE };
