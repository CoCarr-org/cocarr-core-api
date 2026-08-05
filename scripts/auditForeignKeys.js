/**
 * Read-only. Finds every foreign key whose declared column type does not match
 * the type of the primary key it points at.
 *
 *   railway run node scripts/auditForeignKeys.js
 *   node scripts/auditForeignKeys.js            (no DB needed — models only)
 *
 * Why this matters more than it looks: MySQL rejects such a foreign key with
 * "Referencing column X and referenced column Y are incompatible", and a
 * rejected FK during `db.sync({alter:true})` **aborts the entire sync pass**.
 * Every model after the failure point silently never gets its table or its new
 * columns, and the server boots looking healthy. That is how `settlements` went
 * missing, and how `users` lost `firstName` after the schema had already been
 * built correctly — one bad FK elsewhere undid it.
 *
 * Checks both sources of a foreign key:
 *   1. `references` declared directly on an attribute
 *   2. associations (belongsTo / hasMany / hasOne), where Sequelize infers the
 *      column
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('../src/configs/db');

const MODEL_DIR = path.join(__dirname, '..', 'src', 'models');
for (const f of fs.readdirSync(MODEL_DIR).filter((x) => x.endsWith('.js') && x !== 'association.js')) {
  try { require(path.join(MODEL_DIR, f)); } catch { /* reported elsewhere */ }
}
try { require(path.join(MODEL_DIR, 'association.js')); } catch { /* reported elsewhere */ }

// Normalise a Sequelize type to the family that has to match. VARCHAR vs CHAR
// length differences are fine to MySQL; INTEGER vs CHAR is not, and UUID
// (char 36) vs STRING (varchar 255) is not either.
const family = (type) => {
  const key = String(type?.key || type || '').toUpperCase();
  if (key === 'UUID' || key === 'UUIDV4') return 'uuid';
  if (key === 'STRING' || key === 'TEXT' || key === 'CHAR') return 'string';
  if (key === 'INTEGER' || key === 'BIGINT' || key === 'SMALLINT') return 'int';
  if (key === 'DATE' || key === 'DATEONLY') return 'date';
  return key.toLowerCase() || 'unknown';
};

const problems = [];
const checked = [];

const models = db.models;

const pkOf = (model) => {
  const name = model.primaryKeyAttribute;
  return { name, type: model.rawAttributes[name]?.type };
};

const compare = (source, column, targetModel, via) => {
  const src = models[source]?.rawAttributes?.[column];
  if (!src || !targetModel) return;
  const target = pkOf(targetModel);

  const a = family(src.type);
  const b = family(target.type);
  // uuid and string are both character types, but MySQL still refuses char(36)
  // against varchar(255) in an FK — they must be declared the same.
  const ok = a === b;

  const row = {
    source, column, a,
    target: targetModel.name, targetColumn: target.name, b,
    via, ok,
  };
  checked.push(row);
  if (!ok) problems.push(row);
};

for (const name of Object.keys(models)) {
  const model = models[name];

  // 1. Explicit `references` on an attribute.
  for (const [attr, def] of Object.entries(model.rawAttributes)) {
    if (!def.references) continue;
    const refModelName = typeof def.references === 'string'
      ? def.references
      : (def.references.model?.name || def.references.model);
    const target = Object.values(models)
      .find((m) => m.name === refModelName || m.getTableName() === refModelName);
    compare(name, attr, target, 'references');
  }

  // 2. Associations — Sequelize picks the column, which may be declared on the
  //    model with a type that disagrees with the target's PK.
  for (const assoc of Object.values(model.associations || {})) {
    const { associationType } = assoc;
    if (associationType === 'BelongsTo') {
      compare(name, assoc.foreignKey, assoc.target, 'belongsTo');
    } else if (associationType === 'HasMany' || associationType === 'HasOne') {
      // The FK lives on the TARGET, pointing back at this model.
      compare(assoc.target.name, assoc.foreignKey, model, associationType);
    }
  }
}

// De-duplicate: the same pair often shows up via both a reference and an
// association.
const seen = new Set();
const unique = problems.filter((p) => {
  const key = `${p.source}.${p.column}->${p.target}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

console.log(`\nForeign keys checked: ${checked.length}`);
console.log(`Mismatched: ${unique.length}\n`);

if (unique.length) {
  console.log('These will be REJECTED by MySQL and will abort db.sync({alter:true}):\n');
  for (const p of unique) {
    console.log(`  ${p.source}.${p.column} (${p.a})  ->  ${p.target}.${p.targetColumn} (${p.b})   [${p.via}]`);
  }
  console.log('\nFix by declaring the FK column with the same type as the PK it references.\n');
} else {
  console.log('Every foreign key column matches the type of the key it references.\n');
}

process.exit(unique.length ? 1 : 0);
