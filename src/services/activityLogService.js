const ActivityLog = require('../models/activityLog');

// Logging must never break the operation it's attached to — a failed log
// write is a problem for observability, not a reason to fail the request.
async function logActivity({ adminId, adminName, action, entityType, entityId, changes } = {}) {
  try {
    await ActivityLog.create({ adminId, adminName, action, entityType, entityId, changes });
  } catch (error) {
    console.error('[activity-log] failed to write:', error);
  }
}

async function getActivityLogs({ offset, limit, entityType } = {}) {
  const where = {};
  if (entityType) where.entityType = entityType;

  const logs = await ActivityLog.findAll({
    where,
    order: [['createdAt', 'DESC']],
    offset: offset ? parseInt(offset) : 0,
    limit: limit ? parseInt(limit) : 50,
  });
  const totalCount = await ActivityLog.count({ where });

  return { data: logs, totalCount };
}

module.exports = { logActivity, getActivityLogs };
