const { Op, fn, col, literal } = require('sequelize');
const Booking = require('../models/booking');
const Host = require('../models/host');
const User = require('../models/user');
const Vehicle = require('../models/vehicle');
const HostReview = require('../models/hostReview');

const rangeWhere = (from, to, field = 'createdAt') => {
  if (!from && !to) return {};
  const clause = {};
  if (from) clause[Op.gte] = new Date(from);
  if (to) clause[Op.lte] = new Date(`${String(to).slice(0, 10)}T23:59:59`);
  return { [field]: clause };
};

const num = (v) => Number(v || 0);
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

// ── Driver (host) performance report ────────────────────────────
// "Driver" in the spec's language is a host in this codebase — the person
// whose vehicle runs the trip. Counters live on the host row, but they are
// lifetime totals, so anything date-filtered is computed from bookings.
async function getDriverReport({ from, to, limit = 50 } = {}) {
  const where = rangeWhere(from, to);

  const [hosts, bookingStats, ratings] = await Promise.all([
    Host.findAll({
      attributes: ['id', 'name', 'email', 'contactNumber', 'isActive', 'kycVerified',
        'totalRides', 'totalHostCancelledRides', 'totalCustomerCancelledRides', 'totalUncleanRides'],
      raw: true,
    }),
    Booking.findAll({
      attributes: [
        'hostId',
        [fn('COUNT', col('id')), 'bookings'],
        [fn('SUM', col('totalAmount')), 'revenue'],
        [fn('SUM', literal("CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END")), 'cancelled'],
        [fn('SUM', literal("CASE WHEN status = 'finished' THEN 1 ELSE 0 END")), 'completed'],
        [fn('SUM', literal('CASE WHEN delayedBy > 0 THEN 1 ELSE 0 END')), 'delayed'],
      ],
      where, group: ['hostId'], raw: true,
    }),
    HostReview.findAll({
      attributes: ['hostId', [fn('AVG', col('totalRating')), 'rating'], [fn('COUNT', col('id')), 'reviews']],
      group: ['hostId'], raw: true,
    }),
  ]);

  const statsBy = Object.fromEntries(bookingStats.map((s) => [s.hostId, s]));
  const ratingBy = Object.fromEntries(ratings.map((r) => [r.hostId, r]));

  const rows = hosts.map((h) => {
    const s = statsBy[h.id] || {};
    const r = ratingBy[h.id] || {};
    const bookings = num(s.bookings);
    return {
      hostId: h.id,
      name: h.name || '—',
      email: h.email || '',
      contactNumber: h.contactNumber || '',
      isActive: h.isActive,
      kycVerified: h.kycVerified,
      bookings,
      completed: num(s.completed),
      cancelled: num(s.cancelled),
      delayed: num(s.delayed),
      revenue: num(s.revenue),
      completionRate: pct(num(s.completed), bookings),
      cancellationRate: pct(num(s.cancelled), bookings),
      onTimeRate: pct(bookings - num(s.delayed), bookings),
      rating: r.rating ? Math.round(Number(r.rating) * 10) / 10 : null,
      reviews: num(r.reviews),
      lifetimeRides: num(h.totalRides),
      lifetimeUncleanRides: num(h.totalUncleanRides),
    };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, Number(limit));

  const active = rows.filter((r) => r.bookings > 0);
  const totalBookings = active.reduce((a, r) => a + r.bookings, 0);

  return {
    range: { from: from || null, to: to || null },
    summary: {
      totalDrivers: hosts.length,
      activeDrivers: active.length,
      totalBookings,
      totalRevenue: active.reduce((a, r) => a + r.revenue, 0),
      avgCompletionRate: pct(active.reduce((a, r) => a + r.completed, 0), totalBookings),
      avgCancellationRate: pct(active.reduce((a, r) => a + r.cancelled, 0), totalBookings),
      avgRating: (() => {
        const rated = active.filter((r) => r.rating !== null);
        if (!rated.length) return null;
        return Math.round((rated.reduce((a, r) => a + r.rating, 0) / rated.length) * 10) / 10;
      })(),
    },
    drivers: rows,
  };
}

// ── Custom report builder ───────────────────────────────────────
// Everything the UI offers is declared here, so the builder screen renders
// itself from this schema instead of hardcoding a parallel copy that can
// drift. Only these datasets/fields are queryable — an arbitrary column name
// from the client is rejected rather than interpolated into SQL.
const DATASETS = {
  bookings: {
    label: 'Bookings',
    model: () => Booking,
    dateField: 'createdAt',
    groupBy: [
      { key: 'status', label: 'Status' },
      { key: 'rideType', label: 'Ride type' },
      { key: 'deliveryType', label: 'Delivery type' },
      { key: 'hostId', label: 'Host' },
      { key: 'vehicleId', label: 'Vehicle' },
      { key: 'day', label: 'Day', expr: literal('DATE(createdAt)') },
      { key: 'month', label: 'Month', expr: literal("DATE_FORMAT(createdAt, '%Y-%m')") },
    ],
    metrics: [
      { key: 'count', label: 'Number of bookings', expr: () => fn('COUNT', col('id')) },
      { key: 'revenue', label: 'Total revenue', expr: () => fn('SUM', col('totalAmount')) },
      { key: 'avgValue', label: 'Average booking value', expr: () => fn('AVG', col('totalAmount')) },
      { key: 'convenienceFee', label: 'Convenience fees', expr: () => fn('SUM', col('convenienceFee')) },
      { key: 'cancellationFee', label: 'Cancellation fees', expr: () => fn('SUM', col('cancellationFee')) },
      { key: 'discount', label: 'Discount given', expr: () => fn('SUM', col('offerAmount')) },
      { key: 'totalKms', label: 'Kilometres allotted', expr: () => fn('SUM', col('kmAlloted')) },
    ],
    filters: [
      { key: 'status', label: 'Status', type: 'select',
        options: ['initiated', 'booked', 'ongoing', 'finished', 'cancelled'] },
      { key: 'rideType', label: 'Ride type', type: 'text' },
      { key: 'hostId', label: 'Host ID', type: 'text' },
      { key: 'vehicleId', label: 'Vehicle ID', type: 'text' },
    ],
  },
  users: {
    label: 'Users',
    model: () => User,
    dateField: 'createdAt',
    groupBy: [
      { key: 'kycVerified', label: 'KYC verified' },
      { key: 'licenseVerified', label: 'Licence verified' },
      { key: 'day', label: 'Sign-up day', expr: literal('DATE(createdAt)') },
      { key: 'month', label: 'Sign-up month', expr: literal("DATE_FORMAT(createdAt, '%Y-%m')") },
    ],
    metrics: [{ key: 'count', label: 'Number of users', expr: () => fn('COUNT', col('id')) }],
    filters: [
      { key: 'kycVerified', label: 'KYC verified', type: 'boolean' },
      { key: 'licenseVerified', label: 'Licence verified', type: 'boolean' },
    ],
  },
  vehicles: {
    label: 'Vehicles',
    model: () => Vehicle,
    dateField: 'createdAt',
    groupBy: [
      { key: 'vehicleType', label: 'Vehicle type' },
      { key: 'vehicleBrand', label: 'Brand' },
      { key: 'vehicleTransmission', label: 'Transmission' },
      { key: 'vehicleFuelType', label: 'Fuel type' },
      { key: 'vehicleSeats', label: 'Seats' },
      { key: 'hostId', label: 'Host' },
    ],
    metrics: [
      { key: 'count', label: 'Number of vehicles', expr: () => fn('COUNT', col('id')) },
      { key: 'totalRides', label: 'Total rides', expr: () => fn('SUM', col('totalRides')) },
      { key: 'totalKms', label: 'Total kilometres', expr: () => fn('SUM', col('totalKms')) },
      { key: 'avgDeposit', label: 'Average deposit', expr: () => fn('AVG', col('deposit')) },
    ],
    filters: [
      { key: 'vehicleType', label: 'Vehicle type', type: 'text' },
      { key: 'vehicleBrand', label: 'Brand', type: 'text' },
      { key: 'hostId', label: 'Host ID', type: 'text' },
    ],
  },
  hosts: {
    label: 'Hosts / Drivers',
    model: () => Host,
    dateField: 'createdAt',
    groupBy: [
      { key: 'isActive', label: 'Active' },
      { key: 'kycVerified', label: 'KYC verified' },
      { key: 'month', label: 'Joined month', expr: literal("DATE_FORMAT(createdAt, '%Y-%m')") },
    ],
    metrics: [
      { key: 'count', label: 'Number of hosts', expr: () => fn('COUNT', col('id')) },
      { key: 'totalRides', label: 'Total rides', expr: () => fn('SUM', col('totalRides')) },
      { key: 'cancelled', label: 'Host cancellations', expr: () => fn('SUM', col('totalHostCancelledRides')) },
    ],
    filters: [
      { key: 'isActive', label: 'Active', type: 'boolean' },
      { key: 'kycVerified', label: 'KYC verified', type: 'boolean' },
    ],
  },
};

const getReportSchema = () => ({
  datasets: Object.entries(DATASETS).map(([key, d]) => ({
    key, label: d.label,
    groupBy: d.groupBy.map(({ key: k, label }) => ({ key: k, label })),
    metrics: d.metrics.map(({ key: k, label }) => ({ key: k, label })),
    filters: d.filters,
  })),
});

const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });

async function runCustomReport({ dataset, groupBy, metrics = [], filters = {}, from, to, limit = 200, sort } = {}) {
  const config = DATASETS[dataset];
  if (!config) throw invalid(`Unknown dataset: ${dataset}`);

  const chosenMetrics = (Array.isArray(metrics) ? metrics : [metrics]).filter(Boolean);
  if (!chosenMetrics.length) throw invalid('Select at least one metric');

  const metricDefs = chosenMetrics.map((m) => {
    const def = config.metrics.find((x) => x.key === m);
    if (!def) throw invalid(`Unknown metric "${m}" for ${dataset}`);
    return def;
  });

  const groupDef = groupBy ? config.groupBy.find((g) => g.key === groupBy) : null;
  if (groupBy && !groupDef) throw invalid(`Cannot group ${dataset} by "${groupBy}"`);

  // Only declared filter keys reach the query.
  const where = { ...rangeWhere(from, to, config.dateField) };
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === '' || value === undefined || value === null) continue;
    const def = config.filters.find((f) => f.key === key);
    if (!def) throw invalid(`Unknown filter: ${key}`);
    where[key] = def.type === 'boolean' ? (value === true || value === 'true') : value;
  }

  const attributes = [];
  if (groupDef) attributes.push([groupDef.expr || col(groupDef.key), 'groupValue']);
  metricDefs.forEach((m) => attributes.push([m.expr(), m.key]));

  const query = { attributes, where, raw: true, limit: Math.min(Number(limit) || 200, 1000) };
  if (groupDef) {
    query.group = [groupDef.expr || col(groupDef.key)];
    const sortKey = sort && metricDefs.some((m) => m.key === sort) ? sort : metricDefs[0].key;
    query.order = [[literal(sortKey), 'DESC']];
  }

  const rows = await config.model().findAll(query);

  return {
    dataset,
    datasetLabel: config.label,
    range: { from: from || null, to: to || null },
    groupBy: groupDef ? { key: groupDef.key, label: groupDef.label } : null,
    metrics: metricDefs.map(({ key, label }) => ({ key, label })),
    rows: rows.map((r) => {
      const out = { groupValue: groupDef ? (r.groupValue ?? '—') : 'Total' };
      metricDefs.forEach((m) => {
        const v = Number(r[m.key] || 0);
        out[m.key] = Number.isInteger(v) ? v : Math.round(v * 100) / 100;
      });
      return out;
    }),
  };
}

module.exports = { getDriverReport, getReportSchema, runCustomReport };
