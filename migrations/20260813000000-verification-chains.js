// The columns the three verification chains need.
//
// WHY THIS EXISTS SEPARATELY FROM THE BASELINE. The baseline was captured — and
// frozen — before these were added, and a baseline must describe the schema at
// ITS point in history. So the models grew nine columns on `users`, four on
// `hosts` and four on `vehicles` with nothing to create them: boot only REPORTS
// pending migrations, `db.sync({alter:true})` is behind DB_SYNC and development
// only, and the result was `Unknown column 'kycCheckStatus' in 'field list'` on
// every environment whose schema came from migrations.
//
// It went unnoticed because the development database had the columns already —
// added by an alter-sync run by hand — so the code worked everywhere it was
// tested and nowhere it was deployed.
//
// IDEMPOTENT, because that is exactly the split it has to survive: databases
// that already have these columns from an alter-sync, and databases built purely
// from migrations that do not. Each column is added only if absent, so both end
// up identical and re-running changes nothing.
const COLUMNS = {
  users: {
    kycCheckStatus: "ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending'",
    kycCheckReason: 'TEXT NULL',
    kycCheckedAt: 'DATETIME NULL',
    kycCheckedByAdminId: 'CHAR(36) NULL',
    kycCheckNumber: 'VARCHAR(255) NULL',
    photoMatchStatus: "ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending'",
    photoMatchReason: 'TEXT NULL',
    photoMatchedAt: 'DATETIME NULL',
    photoMatchedByAdminId: 'CHAR(36) NULL',
  },
  hosts: {
    verificationStatus: "ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending'",
    verificationReason: 'TEXT NULL',
    verificationReviewedAt: 'DATETIME NULL',
    verificationReviewedByAdminId: 'CHAR(36) NULL',
  },
  vehicles: {
    photosStatus: "ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending'",
    photosReason: 'TEXT NULL',
    photosReviewedAt: 'DATETIME NULL',
    photosReviewedByAdminId: 'CHAR(36) NULL',
  },
};

module.exports = {
  async up(queryInterface) {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      let existing;
      try {
        existing = await queryInterface.describeTable(table);
      } catch (error) {
        // A table that does not exist yet is not this migration's problem — the
        // baseline creates it. Skipping is safer than failing the whole release
        // over a table another migration owns.
        console.warn(`[migrate] ${table} not present, skipping its columns`);
        continue;
      }
      for (const [column, definition] of Object.entries(columns)) {
        if (existing[column]) continue;
        await queryInterface.sequelize.query(
          `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
        );
      }
    }
  },

  // Reversible, unlike the baseline: these columns hold review decisions, which
  // are recoverable by re-reviewing. Dropping them loses that work, so `down`
  // is here for a bad release, not for routine use.
  async down(queryInterface) {
    for (const [table, columns] of Object.entries(COLUMNS)) {
      let existing;
      try {
        existing = await queryInterface.describeTable(table);
      } catch (error) {
        continue;
      }
      for (const column of Object.keys(columns)) {
        if (!existing[column]) continue;
        await queryInterface.sequelize.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
      }
    }
  },
};
