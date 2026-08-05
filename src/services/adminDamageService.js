const { Op } = require('sequelize');
const Damage = require('../models/damage');
const Booking = require('../models/booking');
const Vehicle = require('../models/vehicle');
const User = require('../models/user');
const Host = require('../models/host');
const Image = require('../models/image');
const { logActivity } = require('./activityLogService');
const {
  DAMAGE_PENDING, DAMAGE_APPROVED, DAMAGE_ASSESSED, DAMAGE_REJECTED, DAMAGE_PAID,
} = require('../configs/constants');

const STATUSES = [DAMAGE_PENDING, DAMAGE_APPROVED, DAMAGE_ASSESSED, DAMAGE_REJECTED, DAMAGE_PAID];

const invalid = (m) => Object.assign(new Error(m), { statusCode: 400 });
const missing = (m) => Object.assign(new Error(m), { statusCode: 404 });

// damageImage is stored as a comma-joined string of URLs (see
// damageService.createDamage), not a JSON array — split it so clients get a
// real list instead of having to know the storage format.
const splitImages = (value) => String(value || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function listDamages(params = {}) {
  const { status, search, from, to } = params;
  const offset = Number(params.offset) || 0;
  const limit = Math.min(Number(params.limit) || 20, 100);

  const where = {};
  if (status) {
    if (!STATUSES.includes(status)) throw invalid(`Unknown status: ${status}`);
    where.damageStatus = status;
  }
  if (from || to) {
    where.damageDate = {};
    if (from) where.damageDate[Op.gte] = new Date(from);
    if (to) where.damageDate[Op.lte] = new Date(`${String(to).slice(0, 10)}T23:59:59`);
  }
  if (search) {
    where[Op.or] = [
      { damageType: { [Op.like]: `%${search}%` } },
      { damagedPart: { [Op.like]: `%${search}%` } },
      { damageDescription: { [Op.like]: `%${search}%` } },
    ];
  }

  const { count, rows } = await Damage.findAndCountAll({
    where, offset, limit, order: [['createdAt', 'DESC']],
    include: [{
      model: Booking, as: 'booking', required: false,
      attributes: ['id', 'bookingId', 'startTime', 'endTime', 'status', 'userId', 'hostId', 'vehicleId', 'totalAmount'],
    }],
  });

  // Vehicle/rider/host are two hops from the damage row. Collected in bulk
  // rather than nested includes so one missing association can't break the
  // whole list.
  const bookings = rows.map((r) => r.booking).filter(Boolean);
  const byId = async (Model, ids, attributes) => {
    if (!ids.length) return {};
    const found = await Model.findAll({ where: { id: { [Op.in]: ids } }, attributes });
    return Object.fromEntries(found.map((f) => [f.id, f.toJSON()]));
  };
  const uniq = (key) => [...new Set(bookings.map((b) => b[key]).filter(Boolean))];

  const [vehicles, users, hosts] = await Promise.all([
    byId(Vehicle, uniq('vehicleId'), ['id', 'vehicleName', 'vehicleNumber']),
    byId(User, uniq('userId'), ['id', 'name', 'email', 'contactNumber']),
    byId(Host, uniq('hostId'), ['id', 'name', 'email', 'contactNumber']),
  ]);

  const data = rows.map((r) => {
    const j = r.toJSON();
    const b = j.booking || null;
    return {
      ...j,
      damageImages: splitImages(j.damageImage),
      vehicle: b ? vehicles[b.vehicleId] || null : null,
      rider: b ? users[b.userId] || null : null,
      host: b ? hosts[b.hostId] || null : null,
    };
  });

  // Totals across the whole filtered set, not just this page — an admin
  // triaging claims needs the real exposure, not the page's subtotal.
  const claimed = await Damage.sum('damageAmount', { where }) || 0;
  const approvedTotal = await Damage.sum('damageAmount', {
    where: { ...where, damageStatus: { [Op.in]: [DAMAGE_APPROVED, DAMAGE_PAID] } },
  }) || 0;

  return { data, totalCount: count, totals: { claimed, approved: approvedTotal } };
}

async function getDamage(id) {
  const damage = await Damage.findByPk(id, {
    include: [{ model: Booking, as: 'booking', required: false }],
  });
  if (!damage) throw missing('Damage claim not found');
  const j = damage.toJSON();

  // The verification step is a three-way photo comparison: what the car looked
  // like at pickup, at return, and what the host is claiming. Returning all
  // three together is the whole point — a reviewer cannot judge a claim from
  // the damage photos alone.
  let startImages = [];
  let endImages = [];
  if (j.booking?.id) {
    const images = await Image.findAll({
      where: { bookingId: j.booking.id },
      attributes: ['id', 'url', 'type', 'isStartImage', 'isEndImage'],
      order: [['createdAt', 'ASC']],
    });
    startImages = images.filter((i) => i.isStartImage).map((i) => i.toJSON());
    endImages = images.filter((i) => i.isEndImage).map((i) => i.toJSON());
  }

  return {
    ...j,
    damageImages: splitImages(j.damageImage),
    startImages,
    endImages,
  };
}

// Admins approve/reject a claim and set the amount actually owed, which may
// differ from whatever the host initially claimed.
async function updateDamage(id, { damageStatus, damageAmount }, admin) {
  // Input is validated before the lookup, so bad input costs no DB round-trip
  // and fails the same way whether or not the claim exists.
  let nextStatus;
  if (damageStatus !== undefined) {
    nextStatus = String(damageStatus).toLowerCase();
    if (!STATUSES.includes(nextStatus)) throw invalid(`Invalid damage status: ${damageStatus}`);
    // `paid` is set by the payment flow (damageService.updateDamagePayment
    // attaches the transaction). Letting an admin set it by hand would mark a
    // claim settled with no transaction behind it.
    if (nextStatus === DAMAGE_PAID) {
      throw invalid('A claim becomes "paid" when its payment is recorded — it cannot be set manually');
    }
  }

  let nextAmount;
  const amountGiven = damageAmount !== undefined && damageAmount !== null && damageAmount !== '';
  if (amountGiven) {
    nextAmount = Number(damageAmount);
    if (!Number.isFinite(nextAmount) || nextAmount < 0) {
      throw invalid('Damage amount must be a positive number');
    }
  }

  const damage = await Damage.findByPk(id);
  if (!damage) throw missing('Damage claim not found');

  const changes = {};
  const patch = {};

  if (nextStatus !== undefined && nextStatus !== damage.damageStatus) {
    changes.damageStatus = { from: damage.damageStatus, to: nextStatus };
    patch.damageStatus = nextStatus;
  }
  if (amountGiven && nextAmount !== damage.damageAmount) {
    changes.damageAmount = { from: damage.damageAmount, to: nextAmount };
    patch.damageAmount = nextAmount;
  }

  if (!Object.keys(patch).length) return getDamage(id);

  await damage.update(patch);
  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: patch.damageStatus || 'update',
    entityType: 'DamageClaim', entityId: id, changes,
  });

  return getDamage(id);
}

// ── Verification ──────────────────────────────────────────────────────────
// Step 1 of the flow: the admin compares the ride-start photos, the ride-end
// photos and the damage-report photos, then accepts or rejects the claim.
// Accepting moves it to the assessment team, NOT straight to a charge.
async function verifyDamage(id, { accept, reason }, admin) {
  const damage = await Damage.findByPk(id);
  if (!damage) throw missing('Damage claim not found');
  if (damage.damageStatus !== DAMAGE_PENDING) {
    throw invalid(`This claim is already ${damage.damageStatus}`);
  }

  if (!accept) {
    const text = String(reason || '').trim();
    if (!text) throw invalid('A reason is required when rejecting a claim');
    await damage.update({
      damageStatus: DAMAGE_REJECTED, rejectionReason: text,
      verifiedByAdminId: admin?.id || null, verifiedAt: new Date(),
    });
  } else {
    await damage.update({
      damageStatus: DAMAGE_APPROVED, rejectionReason: null,
      verifiedByAdminId: admin?.id || null, verifiedAt: new Date(),
    });
  }

  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: accept ? 'verify' : 'reject',
    entityType: 'DamageClaim', entityId: id,
    changes: { damageStatus: { from: DAMAGE_PENDING, to: accept ? DAMAGE_APPROVED : DAMAGE_REJECTED } },
  });

  return getDamage(id);
}

// ── Assessment ────────────────────────────────────────────────────────────
// Step 2: the assessment team puts a figure on a verified claim. That figure
// is what the rider's refund is reduced by, so it cannot be zero or missing —
// an assessed claim with no amount would silently refund the full deposit.
async function assessDamage(id, { assessedAmount, notes }, admin) {
  const amount = Number(assessedAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw invalid('An assessed amount is required');
  }

  const damage = await Damage.findByPk(id);
  if (!damage) throw missing('Damage claim not found');
  if (damage.damageStatus !== DAMAGE_APPROVED) {
    throw invalid(
      damage.damageStatus === DAMAGE_PENDING
        ? 'This claim has not been verified yet — check the photos first'
        : `This claim is ${damage.damageStatus} and cannot be assessed`,
    );
  }

  await damage.update({
    damageStatus: DAMAGE_ASSESSED,
    assessedAmount: Math.round(amount),
    // damageAmount is what downstream reads; keep both so the assessor's
    // figure survives even if the charged amount is later adjusted.
    damageAmount: Math.round(amount),
    assessmentNotes: notes || null,
    assessedByAdminId: admin?.id || null,
    assessedAt: new Date(),
  });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'assess',
    entityType: 'DamageClaim', entityId: id,
    changes: { assessedAmount: Math.round(amount), damageStatus: { from: DAMAGE_APPROVED, to: DAMAGE_ASSESSED } },
  });

  return getDamage(id);
}

module.exports = {
  listDamages, getDamage, updateDamage,
  verifyDamage, assessDamage,
  DAMAGE_STATUSES: STATUSES,
};
