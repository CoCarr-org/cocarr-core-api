const { Op, fn, col } = require('sequelize');
const User = require('../models/user');
const Host = require('../models/host');
const Booking = require('../models/booking');
const Membership = require('../models/membership');
const Vehicle = require('../models/vehicle');
const Pickup = require('../models/pickuppoint');
const KycDocument = require('../models/kycDocument');
const DrivingLicence = require('../models/drivingLicence');

// Every audience segment that is actually answerable from the current
// schema. Anything requiring data we don't collect (app opens, device type,
// push-token presence) is deliberately absent rather than offered and broken.
//
// `params` describes the extra inputs each segment needs, so the admin UI can
// render the right controls without hardcoding them.
const SEGMENTS = [
  { key: 'all', label: 'All users', description: 'Everyone in the users table.', params: [] },
  { key: 'riders', label: 'Riders only', description: 'Users who are not registered hosts.', params: [] },
  { key: 'hosts', label: 'Hosts / partners only', description: 'Users with a host record.', params: [] },

  { key: 'kycVerified', label: 'KYC verified', description: 'Identity verified.', params: [] },
  { key: 'kycPending', label: 'KYC submitted, not verified', description: 'Awaiting review — useful for nudges.', params: [] },
  { key: 'kycMissing', label: 'No KYC submitted', description: 'Never started verification.', params: [] },
  { key: 'licenceVerified', label: 'Licence verified', description: 'Driving licence approved.', params: [] },
  { key: 'licenceMissing', label: 'No licence on file', description: 'Cannot book until resolved.', params: [] },

  { key: 'premium', label: 'Premium members', description: 'Active membership.', params: [] },
  { key: 'nonPremium', label: 'Non-members', description: 'No active membership — upsell target.', params: [] },

  { key: 'hasBooked', label: 'Has booked at least once', description: 'Converted customers.', params: [] },
  { key: 'neverBooked', label: 'Never booked', description: 'Signed up but never converted.', params: [] },
  { key: 'repeatCustomers', label: 'Repeat customers', description: 'More than N bookings.',
    params: [{ key: 'minBookings', label: 'Minimum bookings', type: 'number', default: 2 }] },
  { key: 'activeRecently', label: 'Booked recently', description: 'Booked within the last N days.',
    params: [{ key: 'days', label: 'Within last (days)', type: 'number', default: 30 }] },
  { key: 'dormant', label: 'Dormant / win-back', description: 'Booked before, but nothing in the last N days.',
    params: [{ key: 'days', label: 'Inactive for (days)', type: 'number', default: 90 }] },
  { key: 'hasCancelled', label: 'Has cancelled a booking', description: 'At least one cancellation.', params: [] },

  { key: 'signedUpBetween', label: 'Signed up in date range', description: 'Cohort by join date.',
    params: [{ key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' }] },
  { key: 'byCity', label: 'By city', description: 'Users who booked a vehicle in a given city.',
    params: [{ key: 'cityId', label: 'City', type: 'city' }] },
];

const daysAgo = (n) => new Date(Date.now() - (Number(n) || 0) * 86400000);

// Resolves a segment to the User rows it matches. Returns full records so the
// sender has email/contactNumber/name without a second query.
async function resolveAudience(segment, filters = {}) {
  const attributes = ['id', 'name', 'email', 'contactNumber', 'countryCode'];
  const base = { attributes };

  const idsFrom = async (rows, key) => [...new Set(rows.map((r) => r[key]).filter(Boolean))];

  switch (segment) {
    case 'all':
      return User.findAll(base);

    case 'hosts': {
      const hosts = await Host.findAll({ attributes: ['userId'], raw: true });
      const ids = await idsFrom(hosts, 'userId');
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'riders': {
      const hosts = await Host.findAll({ attributes: ['userId'], raw: true });
      const ids = await idsFrom(hosts, 'userId');
      return User.findAll({ ...base, where: ids.length ? { id: { [Op.notIn]: ids } } : {} });
    }

    // Document state lives in the document tables now, so these segments
    // resolve a user-id set from there rather than testing a user column.
    case 'kycVerified':
    case 'kycPending':
    case 'kycMissing':
    case 'licenceVerified':
    case 'licenceMissing': {
      const isKyc = segment.startsWith('kyc');
      const Model = isKyc ? KycDocument : DrivingLicence;
      const numberField = isKyc ? 'documentNumber' : 'licenceNumber';

      const docs = await Model.findAll({
        where: { isCurrent: true }, attributes: ['userId', 'status', numberField], raw: true,
      });

      if (segment === 'kycMissing' || segment === 'licenceMissing') {
        const submitted = [...new Set(docs.filter((d) => d[numberField]).map((d) => d.userId))];
        return User.findAll({ ...base, where: submitted.length ? { id: { [Op.notIn]: submitted } } : {} });
      }

      const wanted = segment.endsWith('Verified') ? 'verified' : 'pending';
      const ids = [...new Set(docs.filter((d) => d.status === wanted && d[numberField]).map((d) => d.userId))];
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'premium':
    case 'nonPremium': {
      const active = await Membership.findAll({
        attributes: ['userId'],
        where: { endingTime: { [Op.gt]: new Date() } },
        raw: true,
      });
      const ids = await idsFrom(active, 'userId');
      if (segment === 'premium') {
        return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
      }
      return User.findAll({ ...base, where: ids.length ? { id: { [Op.notIn]: ids } } : {} });
    }

    case 'hasBooked':
    case 'neverBooked': {
      const booked = await Booking.findAll({ attributes: ['userId'], group: ['userId'], raw: true });
      const ids = await idsFrom(booked, 'userId');
      if (segment === 'hasBooked') {
        return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
      }
      return User.findAll({ ...base, where: ids.length ? { id: { [Op.notIn]: ids } } : {} });
    }

    case 'repeatCustomers': {
      const min = Number(filters.minBookings) || 2;
      const rows = await Booking.findAll({
        attributes: ['userId', [fn('COUNT', col('id')), 'c']],
        group: ['userId'], raw: true,
      });
      const ids = rows.filter((r) => Number(r.c) >= min).map((r) => r.userId).filter(Boolean);
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'activeRecently': {
      const rows = await Booking.findAll({
        attributes: ['userId'],
        where: { createdAt: { [Op.gte]: daysAgo(filters.days || 30) } },
        group: ['userId'], raw: true,
      });
      const ids = await idsFrom(rows, 'userId');
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'dormant': {
      // Booked at some point, but nothing inside the window.
      const [everBooked, recent] = await Promise.all([
        Booking.findAll({ attributes: ['userId'], group: ['userId'], raw: true }),
        Booking.findAll({
          attributes: ['userId'],
          where: { createdAt: { [Op.gte]: daysAgo(filters.days || 90) } },
          group: ['userId'], raw: true,
        }),
      ]);
      const everIds = await idsFrom(everBooked, 'userId');
      const recentIds = new Set(await idsFrom(recent, 'userId'));
      const ids = everIds.filter((id) => !recentIds.has(id));
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'hasCancelled': {
      const rows = await Booking.findAll({
        attributes: ['userId'], where: { status: 'cancelled' }, group: ['userId'], raw: true,
      });
      const ids = await idsFrom(rows, 'userId');
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    case 'signedUpBetween': {
      const where = {};
      if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) where.createdAt[Op.gte] = new Date(filters.from);
        if (filters.to) where.createdAt[Op.lte] = new Date(filters.to);
      }
      return User.findAll({ ...base, where });
    }

    case 'byCity': {
      if (!filters.cityId) return [];
      // Users who booked a vehicle whose pickup point is in that city.
      const bookings = await Booking.findAll({
        attributes: ['userId'],
        include: [{
          model: Vehicle, as: 'vehicle', attributes: [],
          include: [{ model: Pickup, as: 'pickupPoint', attributes: [], where: { cityId: filters.cityId } }],
        }],
        group: ['userId'], raw: true,
      });
      const ids = await idsFrom(bookings, 'userId');
      return User.findAll({ ...base, where: { id: { [Op.in]: ids.length ? ids : ['__none__'] } } });
    }

    default:
      return [];
  }
}

// Recipient counts, split by what each channel can actually reach — an
// audience of 500 with 30 email addresses is important to see BEFORE sending.
async function previewAudience(segment, filters = {}) {
  const users = await resolveAudience(segment, filters);
  const withEmail = users.filter((u) => u.email).length;
  const withPhone = users.filter((u) => u.contactNumber).length;
  return {
    segment,
    total: users.length,
    reachableByEmail: withEmail,
    reachableBySms: withPhone,
    missingEmail: users.length - withEmail,
    missingPhone: users.length - withPhone,
  };
}

module.exports = { SEGMENTS, resolveAudience, previewAudience };
