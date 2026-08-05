/**
 * Recreates `conversations` and `messages`.
 *
 * Why: the first schema-creation run declared conversation.hostId/userId and
 * message.senderId as UUID while they reference users.id, which is a Firebase
 * uid VARCHAR. MySQL rejected the foreign key, which aborted that sync pass —
 * but the two tables had already been CREATEd, with char(36) columns and no FK.
 * A later plain `db.sync()` reports them as present and leaves the wrong types
 * in place, so they have to be dropped and rebuilt.
 *
 * REFUSES TO RUN IF EITHER TABLE HAS ROWS. Dropping them would destroy chat
 * history; this is only safe because they are empty on a fresh schema.
 *
 *   railway run node scripts/repairChatTables.js --dry-run
 *   railway run node scripts/repairChatTables.js --confirm
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM = process.argv.includes('--confirm');

if (!DRY_RUN && !CONFIRM) {
  console.error('Refusing to run without --dry-run or --confirm\n');
  process.exit(1);
}

const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  require(path.join(MODEL_DIR, f));
}
require(path.join(MODEL_DIR, 'association.js'));

// messages depends on conversations, so drop children first and rebuild in the
// reverse order.
const TABLES = ['messages', 'conversations'];

(async () => {
  try {
    await db.authenticate();
    const dbName = db.config.database;

    console.log('');
    for (const t of TABLES) {
      const [[{ n }]] = await db.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      console.log(`${t}: ${n} row(s)`);
      if (Number(n) > 0) {
        console.error(`\nREFUSING — ${t} contains data. Dropping it would destroy chat history.`);
        console.error('Alter the columns by hand instead, or clear the table deliberately first.\n');
        process.exit(1);
      }
    }

    const show = async () => {
      for (const [table, column] of [
        ['conversations', 'hostId'], ['conversations', 'userId'], ['messages', 'senderId'],
      ]) {
        const [r] = await db.query(
          `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
          { replacements: { db: dbName, table, column } },
        );
        console.log(`   ${table}.${column} = ${r.length ? r[0].t : '(absent)'}`);
      }
    };

    console.log('\nBefore:');
    await show();

    if (DRY_RUN) {
      console.log('\nDRY RUN — would drop and recreate messages, conversations.\n');
      process.exit(0);
    }

    // FK checks off for the drop: other tables may reference these, and
    // ordering ~2 tables by hand is fine but the referencing side is not
    // guaranteed. Restored in `finally` so a failure cannot leave the
    // connection with constraints disabled.
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const t of TABLES) {
        await db.query(`DROP TABLE IF EXISTS \`${t}\``);
        console.log(`\n   dropped ${t}`);
      }
    } finally {
      await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    // Rebuild from the models, parents first.
    await db.models.conversation.sync();
    console.log('   created conversations');
    await db.models.message.sync();
    console.log('   created messages');

    console.log('\nAfter:');
    await show();
    console.log('');
    process.exit(0);
  } catch (error) {
    console.error('\nFAILED:', error?.parent?.sqlMessage || error.message);
    process.exit(1);
  }
})();
