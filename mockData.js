/**
 * mockData.js — Realistic, testable mock data generator for COCARR.
 *
 * Uses the app's own DB config (src/configs/db.js), which reads
 * DB_HOST / DB_NAME / DB_USER / DB_PASS / DB_PORT from the environment
 * (via dotenv) — exactly like index.js. So run it wherever those vars are set.
 *
 *   node mockData.js
 *
 * What it does:
 *   - Pulls the EXISTING users from the `users` table (does not create users).
 *   - Reuses the already-seeded cities & brands (from addDefaultCities/Brands).
 *   - Ensures reference rows exist (settings, membership type, protection plan,
 *     an offer, a vendor) — idempotent via findOrCreate.
 *   - Splits users into hosts (~40%) and renters, fleshes out their profiles.
 *   - Gives every host a payout setup + a couple of vehicles (with pickup point
 *     in a real city so `/vehicle?city=` search works), photos, plan, prefs,
 *     and an availability schedule.
 *   - Creates bookings for renters across every status (finished / ongoing /
 *     booked / cancelled) with transactions, plus reviews for finished trips.
 *
 * Idempotent-ish: it tops up to per-host / per-renter targets and skips work
 * that's already there, so re-running won't endlessly duplicate.
 */

require('dotenv').config();
const moment = require('moment');
const db = require('./src/configs/db');
require('./src/models/association');

const User = require('./src/models/user');
const Host = require('./src/models/host');
const Wallet = require('./src/models/wallet');
const WalletTransaction = require('./src/models/wallettransaction');
const ReferralCode = require('./src/models/referralCode');
const City = require('./src/models/city');
const Brand = require('./src/models/brand');
const Vendor = require('./src/models/vendor');
const Vehicle = require('./src/models/vehicle');
const Image = require('./src/models/image');
const VehiclePlan = require('./src/models/vehicleplan');
const VehiclePreference = require('./src/models/vehiclePreference');
const Pickup = require('./src/models/pickuppoint');
const Schedule = require('./src/models/schedule');
const Transaction = require('./src/models/transaction');
const Booking = require('./src/models/booking');
const Review = require('./src/models/review');
const HostReview = require('./src/models/hostReview');
const Damage = require('./src/models/damage');
const HostCommission = require('./src/models/hostCommission');
const HostPayoutAccount = require('./src/models/hostPayoutAccount');
const MembershipType = require('./src/models/membershiptype');
const ProtectionPlan = require('./src/models/protectionplan');
const Offer = require('./src/models/offer');
const Settings = require('./src/models/settings');

const {
  BOOKING_INITIATED, BOOKING_BOOKED, BOOKING_ONGOING, BOOKING_FINISHED, BOOKING_CANCELLED,
  DAMAGE_PENDING,
  TRANSACTION_TYPE_BOOKING, TRANSACTION_PAID,
  CONVENIENCE_FEE, DEPOSIT_AMOUNT, DRIVER_FEE, PICKUP_DROP_FEE,
  FIRST_TIME_OFFER, MAX_POINTS_USAGE, RESCHEDULE_FEE,
} = require('./src/configs/constants');

// -------- config knobs --------
const VEHICLES_PER_HOST = 3;
const BOOKINGS_PER_RENTER = 6; // one of each status (initiated/booked/ongoing/finished×2/cancelled)
const HOST_RATIO = 0.4;

// -------- realistic sample data --------
const NAMES = [
  'Aarav Sharma', 'Vivaan Reddy', 'Aditya Rao', 'Diya Nair', 'Ananya Iyer',
  'Ishaan Gupta', 'Kabir Menon', 'Saanvi Pillai', 'Arjun Verma', 'Meera Krishnan',
  'Rohan Das', 'Priya Patel', 'Karthik Subramaniam', 'Neha Joshi', 'Aditi Bhat',
  'Sai Teja', 'Lakshmi Narayan', 'Rahul Malhotra', 'Sneha Kulkarni', 'Vikram Singh',
];
const MODELS_BY_BRAND = {
  'Maruti Suzuki': ['Swift', 'Baleno', 'Brezza', 'Dzire', 'Ertiga'],
  Hyundai: ['Creta', 'i20', 'Venue', 'Verna', 'Alcazar'],
  Tata: ['Nexon', 'Punch', 'Harrier', 'Tiago', 'Altroz'],
  Mahindra: ['Thar', 'XUV700', 'Scorpio-N', 'Bolero', 'XUV300'],
  Kia: ['Seltos', 'Sonet', 'Carens'],
  Toyota: ['Innova Crysta', 'Fortuner', 'Glanza', 'Urban Cruiser'],
  Honda: ['City', 'Amaze', 'Elevate'],
  MG: ['Hector', 'Astor', 'ZS EV'],
  Volkswagen: ['Virtus', 'Taigun'],
  Skoda: ['Slavia', 'Kushaq'],
};
const GENERIC_MODELS = ['Sedan', 'Hatchback', 'SUV', 'Crossover'];
const TYPES = ['Hatchback', 'Sedan', 'SUV', 'MUV'];
const FUELS = ['Petrol', 'Diesel', 'CNG', 'Electric'];
const TRANSMISSIONS = ['manual', 'automatic'];
const AREAS = ['Central', 'North', 'South', 'Airport Road', 'IT Park', 'Downtown', 'Lake View'];
const FEATURES = 'Sunroof,Cruise Control,Reverse Camera,Bluetooth,Airbags,ABS';
const LUXURY_BRANDS = new Set(['Mercedes-Benz', 'BMW', 'Audi', 'Volvo', 'Jaguar', 'Land Rover', 'Lexus', 'Porsche', 'Bentley', 'Rolls-Royce', 'Maserati', 'Ferrari', 'Lamborghini', 'Aston Martin', 'Maybach', 'Lotus', 'McLaren', 'Bugatti']);

// The vehicles table has an integer `vehicleId` column (separate from the UUID
// primary key) that /vehicle/:id looks up by. Assign unique ones per run.
let vehicleIdSeq = 1001;

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const between = (a, b) => a + rand(b - a + 1);
const uid = () => Math.random().toString(36).slice(2, 8);

async function safe(label, fn) {
  try { return await fn(); }
  catch (e) { console.error(`  ✗ ${label}: ${e.message}`); return null; }
}

async function ensureReference() {
  await safe('settings', () => Settings.bulkCreate([
    { type: CONVENIENCE_FEE, label: 'Convenience Fee', value: '199' },
    { type: DEPOSIT_AMOUNT, label: 'Security Deposit', value: '3999' },
    { type: DRIVER_FEE, label: 'Driver / Delivery Fee', value: '499' },
    { type: PICKUP_DROP_FEE, label: 'Pickup & Drop Fee', value: '299' },
    { type: FIRST_TIME_OFFER, label: 'First Time Offer %', value: '15' },
    { type: MAX_POINTS_USAGE, label: 'Max Wallet Points / Booking', value: '500' },
    { type: RESCHEDULE_FEE, label: 'Reschedule Fee', value: '149' },
  ], { ignoreDuplicates: true }));

  const [membershipType] = await MembershipType.findOrCreate({
    where: { membershipName: 'CoCarr Plus (Annual)' },
    defaults: { membershipAmount: 1999, membershipOfferAmount: 1499, membershipRideOffer: 10, membershipOfferMax: 500, status: true },
  });

  let protectionPlan = await ProtectionPlan.findOne({ where: { deleted: false } });
  if (!protectionPlan) {
    protectionPlan = await ProtectionPlan.create({
      // endDate must be NULL — bookingSummary treats a null endDate as the
      // currently-active plan; a set endDate breaks the price summary.
      startDate: moment().subtract(30, 'days').toDate(), endDate: null,
      basicPlanPrice: 149, basicPlanLuxuryPrice: 299, basicPlanExtraHourPrice: 15, basicPlanLuxuryExtraHourPrice: 30,
      silverPlanPrice: 249, silverPlanLuxuryPrice: 449, silverPlanExtraHourPrice: 25, silverPlanLuxuryExtraHourPrice: 45,
      goldPlanPrice: 399, goldPlanLuxuryPrice: 699, goldPlanExtraHourPrice: 40, goldPlanLuxuryExtraHourPrice: 70,
      basicPlanAccidentAmount: 5000, basicPlanLuxuryAccidentAmount: 10000,
      silverPlanAccidentAmount: 3000, silverPlanLuxuryAccidentAmount: 6000,
      goldPlanAccidentAmount: 1000, goldPlanLuxuryAccidentAmount: 2000,
      minHours: 12, maxHours: 720, deleted: false,
    });
  }

  await Offer.findOrCreate({
    where: { code: 'WELCOME15' },
    defaults: {
      description: 'Flat 15% off (max ₹300) for your first ride.',
      discountType: 'percent', discountValue: 15, maxDiscountAmount: 300,
      minBookingAmount: 500, maxBookingAmount: 20000, minHours: 12, maxHours: 720,
      validFrom: moment().subtract(15, 'days').toDate(), validTo: moment().add(60, 'days').toDate(),
      maxUses: 1000, offerApplicableOn: 'all', firstTimeUser: true,
      isPlatformOffer: true, createdBy: 'system', isActive: true, offerType: 'company',
    },
  });

  const [vendor] = await Vendor.findOrCreate({
    where: { id: 'vendor-mock' },
    defaults: { name: 'CoCarr Fleet Ops', email: 'fleet.mock@cocarr.in', mobile: '+919000000001', permission: 1, lastActivity: new Date(), isActive: true },
  });

  return { membershipType, protectionPlan, vendor };
}

function modelFor(brandName) {
  return pick(MODELS_BY_BRAND[brandName] || GENERIC_MODELS);
}

async function makeVehicleForHost(hostRecord, hostUser, cities, brands, ref) {
  const city = pick(cities);
  // Prefer brands we have real model names for, so vehicles read realistically.
  const known = brands.filter((b) => MODELS_BY_BRAND[b.name]);
  const brand = known.length && Math.random() < 0.85 ? pick(known) : pick(brands);
  const modelName = modelFor(brand.name);
  const isLuxury = LUXURY_BRANDS.has(brand.name);
  const plate = `TS${between(10, 39)}${String.fromCharCode(65 + rand(26))}${String.fromCharCode(65 + rand(26))}${between(1000, 9999)}`;

  const pickup = await Pickup.create({
    name: `${pick(AREAS)} Hub, ${city.name}`, cityId: city.id, hostId: hostRecord.id,
    address: `${pick(AREAS)}, ${city.name}`, lat: parseFloat(city.lat) || 17.4, long: parseFloat(city.lng) || 78.4,
  });

  const weekday = isLuxury ? between(6000, 14000) : between(1800, 4500);
  const vehicle = await Vehicle.create({
    pickupId: pickup.id, vehicleNumber: plate, vehicleId: vehicleIdSeq++,
    vehicleName: `${brand.name} ${modelName}`, vehicleYear: between(2018, 2024),
    vehicleRcNumber: `RC-${plate}`, vehicleRcVerified: true,
    vehicleBrand: brand.id, vehicleType: pick(TYPES), vehicleCc: between(1000, 2500),
    vehicleTransmission: pick(TRANSMISSIONS), vehicleFuelType: pick(FUELS), vehicleSeats: pick([4, 5, 5, 5, 7]),
    deposit: isLuxury ? 9999 : 3999, totalRides: between(0, 60), totalKms: between(5000, 60000),
    ownerType: 1, hostId: hostRecord.id,
    reviews: between(0, 25), rating: (Math.round((3.8 + Math.random() * 1.2) * 10) / 10), totalReviews: between(0, 25),
    description: `Well-maintained ${brand.name} ${modelName} available in ${city.name}. Clean, serviced and ready to drive.`,
    active: true, features: FEATURES, isLuxury,
    isDeliveryAvailable: Math.random() > 0.3, isPickupAvailable: true,
    rcVerified: true, isAdminApproved: true,
  });

  await pickup.update({ vehicleId: vehicle.id });

  await Image.bulkCreate([
    { vehicleId: vehicle.id, isCover: true, url: `https://picsum.photos/seed/${vehicle.id}-1/800/600`, type: 'front' },
    { vehicleId: vehicle.id, url: `https://picsum.photos/seed/${vehicle.id}-2/800/600`, type: 'back' },
    { vehicleId: vehicle.id, url: `https://picsum.photos/seed/${vehicle.id}-3/800/600`, type: 'side' },
  ]);

  await VehiclePlan.create({
    vehicleId: vehicle.id, kmAlloted: pick([200, 250, 300]), extraKmFee: between(6, 12), perHourFee: between(80, 200),
    weekdayFee: weekday, weekendFee: Math.round(weekday * 1.2),
    startTime: moment().startOf('day').toDate(), endTime: moment().endOf('day').toDate(),
  });

  await VehiclePreference.create({
    vehicleId: vehicle.id, hostId: hostRecord.id,
    midnightBooking: Math.random() > 0.5, selfPickup: true, deliverAvailable: Math.random() > 0.3,
  });

  // Wide availability window so search finds it for "now" and near-future dates.
  await Schedule.create({
    vehicleId: vehicle.id, startTime: moment().subtract(60, 'days').toDate(),
    endTime: moment().add(120, 'days').toDate(), status: 'available',
  });

  return vehicle;
}

async function makeBookingForRenter(renter, vehicle, status, ref, opts = {}) {
  const past = status === BOOKING_FINISHED || status === BOOKING_CANCELLED;
  const ongoing = status === BOOKING_ONGOING;
  const startBase = past
    ? moment().subtract(between(2, 40), 'days')
    : ongoing ? moment().subtract(between(2, 12), 'hours') : moment().add(between(1, 20), 'days');
  const start = startBase.clone().hour(between(8, 18)).minute(0).second(0);
  const end = start.clone().add(pick([12, 24, 24, 48]), 'hours');
  const total = between(1500, 6000);

  const txn = await Transaction.create({
    orderId: `order_bk_${uid()}`, paymentId: `pay_bk_${uid()}`, paymentMethod: pick(['card', 'upi', 'wallet']),
    userId: renter.id, amount: total, type: TRANSACTION_TYPE_BOOKING,
    initiatedTime: start.toDate(), executedTime: start.toDate(), paymentStatus: TRANSACTION_PAID,
  });

  const base = {
    bookingId: `CC${uid().toUpperCase()}`, transactionId: txn.id,
    startTime: start.toDate(), endTime: end.toDate(),
    address: vehicle.address, lat: '17.4239', lng: '78.4083',
    convenienceFee: 199, protectionPlanFee: 149, protectionPlan: ref.protectionPlan?.id,
    deliveryFee: 0, deliveryType: 'self', rideType: 1, kmAlloted: 300, extraKmFee: 8,
    totalAmount: total, WalletPointsAwarded: 50, walletPointsUsed: 0, depositAmount: 3999,
    userId: renter.id, vehicleId: vehicle.id, hostId: vehicle.hostId,
    paymentType: 'online', bookingType: 'online', status,
  };

  if (status === BOOKING_FINISHED) {
    Object.assign(base, {
      pickupTime: start.clone().add(6, 'minutes').toDate(), dropTime: end.clone().add(20, 'minutes').toDate(),
      startKms: between(10000, 50000), endKms: between(50001, 50400), startFuel: 80, endFuel: 55,
      startImage: 'https://picsum.photos/seed/start/600', endImage: 'https://picsum.photos/seed/end/600',
      startOtp: between(1000, 9999), endOtp: between(1000, 9999), startOtpVerified: true, endOtpVerified: true,
    });
  } else if (status === BOOKING_ONGOING) {
    Object.assign(base, {
      pickupTime: start.clone().add(5, 'minutes').toDate(), startKms: between(10000, 50000),
      startFuel: 75, startOtp: between(1000, 9999), startOtpVerified: true,
    });
  }

  const booking = await Booking.create(base);

  // Start photos exist once a ride is picked up (ongoing/finished); end photos
  // once it's finished. The UI reads these from the `images` table
  // (isStartImage / isEndImage), not the scalar columns above.
  if (status === BOOKING_ONGOING || status === BOOKING_FINISHED) {
    await safe('startImages', () => Image.bulkCreate([
      { vehicleId: vehicle.id, bookingId: booking.id, isStartImage: true, url: `https://picsum.photos/seed/start-${uid()}/600`, type: 'other' },
      { vehicleId: vehicle.id, bookingId: booking.id, isStartImage: true, url: `https://picsum.photos/seed/start-${uid()}/600`, type: 'fuelOdometer' },
    ]));
  }
  if (status === BOOKING_FINISHED) {
    await safe('endImages', () => Image.bulkCreate([
      { vehicleId: vehicle.id, bookingId: booking.id, isEndImage: true, url: `https://picsum.photos/seed/end-${uid()}/600`, type: 'other' },
      { vehicleId: vehicle.id, bookingId: booking.id, isEndImage: true, url: `https://picsum.photos/seed/end-${uid()}/600`, type: 'fuelOdometer' },
    ]));
    await safe('review', () => Review.create({
      totalRating: between(4, 5), cleanlinessRating: between(4, 5), comfortRating: between(4, 5),
      hostRating: between(4, 5), handlingRating: between(3, 5),
      userId: renter.id, vehicleId: vehicle.id, bookingId: booking.id,
      comment: pick(['Great car, smooth ride!', 'Clean and well maintained.', 'Courteous host, would book again.', 'Good value for money.']),
    }));
    await safe('hostReview', () => HostReview.create({
      totalRating: between(4, 5), hostId: vehicle.hostId, userId: renter.id,
      vehicleId: vehicle.id, bookingId: booking.id, comment: 'Returned clean and on time.',
    }));

    // One finished booking per renter carries a reported damage so the host
    // damage flow (and its UI) has real data to render.
    if (opts.withDamage) {
      await safe('damage', () => Damage.create({
        bookingId: booking.id,
        damagedPart: pick(['front-bumper', 'rear-bumper', 'front-driver-door', 'left-quarter-panel']),
        damageType: pick(['scratch', 'dent', 'minor-damage']),
        damageDescription: 'Minor scratch noticed on return, photos attached.',
        damageImage: [
          `${process.env.API_URL || ''}/image/${uid()}`,
          `${process.env.API_URL || ''}/image/${uid()}`,
        ].join(','),
        damageStatus: DAMAGE_PENDING,
        damageDate: new Date(),
      }));
    }
  }
  return booking;
}

async function run() {
  console.log('Connecting…');
  await db.authenticate();

  vehicleIdSeq = (Number(await Vehicle.max('vehicleId')) || 1000) + 1;
  const [cities, brands, users] = await Promise.all([
    City.findAll(), Brand.findAll(), User.findAll({ order: [['createdAt', 'ASC']] }),
  ]);
  console.log(`Found ${users.length} users, ${cities.length} cities, ${brands.length} brands.`);
  if (!users.length) { console.error('No users in DB — nothing to attach data to. Aborting.'); return; }
  if (!cities.length || !brands.length) { console.error('Cities/brands not seeded yet. Boot the app once (or seed) first.'); return; }

  const ref = await ensureReference();

  // Every user is both a host (owns cars) and a renter (makes bookings).
  const hostUsers = users;
  const renterUsers = users;

  // Flesh out profiles + wallets (only fill blanks, don't clobber real data).
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    await safe(`profile ${u.id}`, async () => {
      const patch = {};
      if (!u.name) patch.name = NAMES[i % NAMES.length];
      if (!u.email) patch.email = `user${i + 1}.${uid()}@example.com`;
      patch.emailVerified = true; patch.contactVerified = true;
      patch.licenseVerified = true; patch.kycVerified = true; patch.isActive = true;
      if (!u.kycNumber) patch.kycNumber = `ABCDE${between(1000, 9999)}F`;
      if (!u.licenseNumber) patch.licenseNumber = `TS${between(10, 39)}${between(2015, 2023)}${between(100000, 999999)}`;
      await u.update(patch);
    });
    // Referral code now lives in its own table, minted active for active users.
    await safe(`referral code ${u.id}`, () => ReferralCode.findOrCreate({
      where: { userId: u.id },
      defaults: { userId: u.id, code: `COCARR${uid().toUpperCase()}`.slice(0, 12), status: 'active', activatedAt: new Date() },
    }));
    await safe(`wallet ${u.id}`, () => Wallet.findOrCreate({
      where: { userId: u.id },
      defaults: { userId: u.id, walletPoints: pick([0, 100, 250, 500]), referralPoints: pick([0, 500]), maxWalletPoints: 2000 },
    }));
  }

  // Hosts + vehicles.
  const allVehicles = [];
  for (const hu of hostUsers) {
    const hostRecord = await safe(`host ${hu.id}`, async () => {
      const [h] = await Host.findOrCreate({
        where: { userId: hu.id },
        defaults: {
          userId: hu.id, name: hu.name || pick(NAMES), profilePhoto: `https://picsum.photos/seed/${hu.id}/200`,
          contactNumber: hu.contactNumber || `+9190000000${between(10, 99)}`, contactVerified: true,
          email: hu.email, emailVerified: true, kycNumber: `ABCDE${between(1000, 9999)}F`, kycVerified: true,
          referralCode: `HOST${uid().toUpperCase()}`, totalRides: between(5, 60), isActive: true,
        },
      });
      return h;
    });
    if (!hostRecord) continue;
    await safe('hostCommission', () => HostCommission.findOrCreate({
      where: { hostId: hostRecord.id },
      defaults: { hostId: hostRecord.id, startDate: moment().subtract(30, 'days').toDate(), commissionPercentage: 15, isActive: true },
    }));
    await safe('payoutAccount', () => HostPayoutAccount.findOrCreate({
      where: { hostId: hostRecord.id },
      defaults: {
        hostId: hostRecord.id, paymentMethod: 'bank', accountNumber: `${between(1000, 9999)}`,
        hostProvidedName: hostRecord.name || hu.name || 'CoCarr Host',
        accountHolderName: (hostRecord.name || hu.name || 'COCARR HOST').toUpperCase(),
        isVerified: true, isManuallyVerified: true, referenceId: `ref_${uid()}`,
        ifscCode: 'HDFC0001234', bankName: 'HDFC Bank', city: pick(cities).name, branchName: 'Main Branch', isActive: true,
      },
    }));

    const existing = await Vehicle.count({ where: { hostId: hostRecord.id } });
    for (let v = existing; v < VEHICLES_PER_HOST; v++) {
      const veh = await safe(`vehicle for host ${hu.id}`, () => makeVehicleForHost(hostRecord, hu, cities, brands, ref));
      if (veh) allVehicles.push(veh);
    }
  }

  // Build a host.id -> owner userId map so every booking's hostId resolves to
  // the real owner, and so renters book OTHER people's cars (never their own).
  const hostRows = await Host.findAll({ attributes: ['id', 'userId'] });
  const ownerUserByHostId = Object.fromEntries(hostRows.map((h) => [h.id, h.userId]));
  const pool = await Vehicle.findAll();

  if (pool.length) {
    // Full lifecycle: two finished (one carries damage), one of every other state.
    const statuses = [BOOKING_FINISHED, BOOKING_FINISHED, BOOKING_ONGOING, BOOKING_BOOKED, BOOKING_CANCELLED, BOOKING_INITIATED];
    for (const renter of renterUsers) {
      const existing = await Booking.count({ where: { userId: renter.id } });
      const others = pool.filter((v) => ownerUserByHostId[v.hostId] && ownerUserByHostId[v.hostId] !== renter.id);
      const chooseFrom = others.length ? others : pool;
      for (let b = existing; b < BOOKINGS_PER_RENTER; b++) {
        const idx = b % statuses.length;
        const vehicle = pick(chooseFrom);
        // idx 1 is the second finished booking — attach a reported damage to it.
        await safe(`booking for ${renter.id}`, () => makeBookingForRenter(renter, vehicle, statuses[idx], ref, { withDamage: idx === 1 }));
      }
    }
  }

  // Summary.
  const [vc, bc] = await Promise.all([Vehicle.count(), Booking.count()]);
  console.log(`\nDone. Totals now — vehicles: ${vc}, bookings: ${bc}.`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('Fatal:', e); process.exit(1); });
