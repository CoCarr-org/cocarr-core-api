const { Op } = require('sequelize');
const { CustomError } = require('../middlewares/error');
const { logActivity } = require('./activityLogService');

// Most of the new admin modules (banners, FAQs, pages, flags, templates,
// IP whitelist) are plain CRUD over one table with the same needs: paginated
// list, search, activity logging, 404 on missing. This builds that once
// rather than copy-pasting it eleven times.
//
// opts:
//   model        Sequelize model
//   entityType   label used in the activity log
//   searchable   columns included in ?search=
//   defaultSort  e.g. '-createdAt'
//   allowed      writable fields (anything else in the body is ignored, so a
//                client can't set id/timestamps/etc.)
function createCrudService({ model, entityType, searchable = [], defaultSort = '-createdAt', allowed = [] }) {
  const pick = (body) => {
    const out = {};
    allowed.forEach((f) => { if (body[f] !== undefined) out[f] = body[f]; });
    return out;
  };

  async function list({ search, sort, offset = 0, limit = 25, filters = {} } = {}) {
    const where = { ...filters };
    if (search && searchable.length) {
      where[Op.or] = searchable.map((col) => ({ [col]: { [Op.like]: `%${search}%` } }));
    }

    const sortStr = sort || defaultSort;
    const dir = sortStr.startsWith('-') ? 'DESC' : 'ASC';
    const field = sortStr.replace(/^-/, '');

    const data = await model.findAll({
      where,
      order: [[field, dir]],
      offset: parseInt(offset) || 0,
      limit: parseInt(limit) || 25,
    });
    const totalCount = await model.count({ where });
    return { data, totalCount };
  }

  async function getById(id) {
    const row = await model.findByPk(id);
    if (!row) throw new CustomError(`${entityType} not found`, 404);
    return row;
  }

  async function create(body, actingAdmin) {
    const row = await model.create(pick(body));
    await logActivity({
      adminId: actingAdmin?.id,
      adminName: actingAdmin?.name,
      action: 'create',
      entityType,
      entityId: row.id,
      changes: { created: row.toJSON() },
    });
    return row;
  }

  async function update(id, body, actingAdmin) {
    const row = await getById(id);
    const before = row.toJSON();
    const fields = pick(body);
    await row.update(fields);

    const changed = {};
    Object.keys(fields).forEach((k) => {
      if (String(before[k]) !== String(fields[k])) changed[k] = { from: before[k], to: fields[k] };
    });
    if (Object.keys(changed).length) {
      await logActivity({
        adminId: actingAdmin?.id,
        adminName: actingAdmin?.name,
        action: 'update',
        entityType,
        entityId: id,
        changes: changed,
      });
    }
    return row;
  }

  async function remove(id, actingAdmin) {
    const row = await getById(id);
    const snapshot = row.toJSON();
    await row.destroy();
    await logActivity({
      adminId: actingAdmin?.id,
      adminName: actingAdmin?.name,
      action: 'delete',
      entityType,
      entityId: id,
      changes: { deleted: snapshot },
    });
    return { success: true };
  }

  return { list, getById, create, update, remove };
}

module.exports = { createCrudService };
