/**
 * seed.js — Populate the database with realistic mock data.
 *
 * Reuses the app's own DB connection/config (src/configs/db.js), which reads
 * DB_HOST / DB_NAME / DB_USER / DB_PASS / DB_PORT from the environment via
 * dotenv — exactly like index.js. Run it wherever those vars are set:
 *
 *     node seed.js
 *     node seed.js <hostUserId> <renterUserId>   # pick specific users
 *
 * It takes the two existing rows in the `user` table (or the two ids passed on
 * the CLI), treats the first as a HOST and the second as a RENTER, and builds a
 * complete, internally-consistent booking story across all the related tables.
 *
 * The core graph is written inside a single transaction (all-or-nothing). A few
 * legacy integer-keyed tables (offerCities / offerUsage / UserReferral) are
 * seeded best-effort afterwards, since their columns don't line up with the
 * UUID primary keys they nominally reference.
 */

require('dotenv').config();

const moment = require('moment');
const db = require('./src/configs/db');

// Register model associations the same way the app does.
require('./src/models/association');

const {
  BOOKING_FINISHED,
  TRANSACTION_TYPE_BOOKING,
  TRANSACTION_TYPE_MEMBERSHIP,
  TRANSACTION_TYPE_EXTENSION,
  TRANSACTION_TYPE_DUE,
  TRANSACTION_TYPE_RESCHEDULE,
  TRANSACTION_PAID,
  MEMBERSHIP_SUBSCRIBED,
  REFUND_PROCESSED,
  DUE_PAID,
  EXTENSION_DONE,
  RESCHEDULE_DONE,
  DRIVER_FEE,
  CONVENIENCE_FEE,
  DEPOSIT_AMOUNT,
  PICKUP_DROP_FEE,
  FIRST_TIME_OFFER,
  MAX_POINTS_USAGE,
  RESCHEDULE_FEE,
} = require('./src/configs/constants');

// Models
const User = require('./src/models/user');
const Host = require('./src/models/host');
const Wallet = require('./src/models/wallet');
const WalletTransaction = require('./src/models/wallettransaction');
const City = require('./src/models/city');
const Brand = require('./src/models/brand');
const Model = require('./src/models/model');
const Vendor = require('./src/models/vendor');
const Vehicle = require('./src/models/vehicle');
const Image = require('./src/models/image');
const VehiclePlan = require('./src/models/vehicleplan');
const VehiclePreference = require('./src/models/vehiclePreference');
const Pickup = require('./src/models/pickuppoint');
const Schedule = require('./src/models/schedule');
const ScheduleBlock = require('./src/models/scheduleBlock');
const Transaction = require('./src/models/transaction');
const Booking = require('./src/models/booking');
const Review = require('./src/models/review');
const HostReview = require('./src/models/hostReview');
const MembershipType = require('./src/models/membershiptype');
const Membership = require('./src/models/membership');
const Damage = require('./src/models/damage');
const Due = require('./src/models/due');
const Extension = require('./src/models/extension');
const Reschedule = require('./src/models/reschedule');
const Refund = require('./src/models/refund');
const ProtectionPlan = require('./src/models/protectionplan');
const HostCommission = require('./src/models/hostCommission');
const HostPayoutAccount = require('./src/models/hostPayoutAccount');
const HostPayoutLedger = require('./src/models/hostPayoutLedger');
const HostInvoice = require('./src/models/hostInvoice');
const Settings = require('./src/models/settings');
const Offer = require('./src/models/offer');
const Conversation = require('./src/models/conversation');
const Message = require('./src/models/messages');
const FcmToken = require('./src/models/fcmTokens');
const Admin = require('./src/models/admin');
const Influencer = require('./src/models/influencer');
const OfferCities = require('./src/models/offerCities');
const OfferUsage = require('./src/models/offerUsage');
const ReferralCode = require('./src/models/referralCode');
const Referral = require('./src/models/referral');

// Short unique-ish suffix so re-running doesn't collide on UNIQUE columns.
const SFX = Date.now().toString().slice(-6);

async function main() {
  await db.authenticate();
  console.log('DB connection OK.\n');

  // ---- Resolve the two users --------------------------------------------
  const [hostArgId, renterArgId] = process.argv.slice(2);
  let hostUser, renterUser;

  if (hostArgId && renterArgId) {
    hostUser = await User.findByPk(hostArgId);
    renterUser = await User.findByPk(renterArgId);
    if (!hostUser) throw new Error(`No user found for host id ${hostArgId}`);
    if (!renterUser) throw new Error(`No user found for renter id ${renterArgId}`);
  } else {
    const users = await User.findAll({ order: [['createdAt', 'ASC']], limit: 2 });
    if (users.length < 2) {
      throw new Error(
        `Expected at least 2 rows in the user table, found ${users.length}. ` +
        `Pass ids explicitly: node seed.js <hostUserId> <renterUserId>`
      );
    }
    [hostUser, renterUser] = users;
  }

  console.log(`HOST   user -> ${hostUser.id}`);
  console.log(`RENTER user -> ${renterUser.id}\n`);

  const t = await db.transaction();
  try {
    // ---- 1. Flesh out the two user profiles -----------------------------
    await hostUser.update({
      name: 'Rajesh Kumar',
      email: `rajesh.kumar.${SFX}@example.com`,
      emailVerified: true,
      contactVerified: true,
      licenseNumber: `TS0720190001${SFX}`,
      licenseVerified: true,
      kycNumber: `ABCDE1234F`,
      kycVerified: true,
      totalRides: 42,
      lastCleanRides: 40,
      isActive: true,
    }, { transaction: t });

    await renterUser.update({
      name: 'Ananya Sharma',
      email: `ananya.sharma.${SFX}@example.com`,
      emailVerified: true,
      contactVerified: true,
      licenseNumber: `TS0820210007${SFX}`,
      licenseVerified: true,
      kycNumber: `PQRSX5678K`,
      kycVerified: true,
      totalRides: 5,
      lastCleanRides: 5,
      isActive: true,
    }, { transaction: t });

    // ---- 2. Reference / config tables -----------------------------------
    const city = await City.create({
      name: 'Hyderabad', icon: 'https://picsum.photos/seed/hyd/80',
      active: true, lat: '17.3850', lng: '78.4867',
    }, { transaction: t });

    const brand = await Brand.create({ name: 'Hyundai' }, { transaction: t });
    const carModel = await Model.create(
      { id: `creta-${SFX}`, name: 'Creta', brand: brand.id }, { transaction: t }
    );

    const vendor = await Vendor.create({
      id: `vendor-${SFX}`, name: 'CoCarr Fleet Ops', email: `fleet.${SFX}@cocarr.in`,
      mobile: '+919000000001', city: city.id, permission: 1,
      lastActivity: new Date(), isActive: true,
    }, { transaction: t });

    const settings = await Settings.bulkCreate([
      { type: CONVENIENCE_FEE, label: 'Convenience Fee', value: '199' },
      { type: DEPOSIT_AMOUNT, label: 'Security Deposit', value: '3999' },
      { type: DRIVER_FEE, label: 'Driver / Delivery Fee', value: '499' },
      { type: PICKUP_DROP_FEE, label: 'Pickup & Drop Fee', value: '299' },
      { type: FIRST_TIME_OFFER, label: 'First Time Offer %', value: '15' },
      { type: MAX_POINTS_USAGE, label: 'Max Wallet Points / Booking', value: '500' },
      { type: RESCHEDULE_FEE, label: 'Reschedule Fee', value: '149' },
    ], { transaction: t });

    const membershipType = await MembershipType.create({
      membershipName: 'CoCarr Plus (Annual)',
      membershipAmount: 1999.0,
      membershipOfferAmount: 1499.0,
      membershipRideOffer: 10.0,
      membershipOfferMax: 500.0,
      status: true,
    }, { transaction: t });

    const protectionPlan = await ProtectionPlan.create({
      startDate: moment().subtract(30, 'days').toDate(),
      endDate: moment().add(335, 'days').toDate(),
      basicPlanPrice: 149, basicPlanLuxuryPrice: 299,
      basicPlanExtraHourPrice: 15, basicPlanLuxuryExtraHourPrice: 30,
      silverPlanPrice: 249, silverPlanLuxuryPrice: 449,
      silverPlanExtraHourPrice: 25, silverPlanLuxuryExtraHourPrice: 45,
      goldPlanPrice: 399, goldPlanLuxuryPrice: 699,
      goldPlanExtraHourPrice: 40, goldPlanLuxuryExtraHourPrice: 70,
      basicPlanAccidentAmount: 5000, basicPlanLuxuryAccidentAmount: 10000,
      silverPlanAccidentAmount: 3000, silverPlanLuxuryAccidentAmount: 6000,
      goldPlanAccidentAmount: 1000, goldPlanLuxuryAccidentAmount: 2000,
      minHours: 12, maxHours: 720, deleted: false,
    }, { transaction: t });

    const offer = await Offer.create({
      code: `WELCOME${SFX}`,
      description: 'Flat 15% off (max ₹300) for your first ride.',
      discountType: 'percent', discountValue: 15.0, maxDiscountAmount: 300.0,
      minBookingAmount: 500.0, maxBookingAmount: 20000.0,
      minHours: 12, maxHours: 720,
      validFrom: moment().subtract(15, 'days').toDate(),
      validTo: moment().add(60, 'days').toDate(),
      maxUses: 1000, offerApplicableOn: 'all', firstTimeUser: true,
      isPlatformOffer: true, createdBy: 'system', isActive: true, offerType: 'company',
    }, { transaction: t });

    // ---- 3. Host + payout setup -----------------------------------------
    const host = await Host.create({
      userId: hostUser.id, name: 'Rajesh Kumar',
      profilePhoto: 'https://picsum.photos/seed/rajesh/200',
      contactNumber: hostUser.contactNumber || '+919000000010',
      contactVerified: true, email: hostUser.email, emailVerified: true,
      kycNumber: 'ABCDE1234F', kycVerified: true,
      referralCode: `HOSTRAJ${SFX}`, totalRides: 42, isActive: true,
    }, { transaction: t });

    const hostCommission = await HostCommission.create({
      hostId: host.id, startDate: moment().subtract(30, 'days').toDate(),
      commissionPercentage: 15.0, isActive: true,
    }, { transaction: t });

    await HostPayoutAccount.create({
      hostId: host.id, paymentMethod: 'bank', accountNumber: '4321',
      hostProvidedName: 'Rajesh Kumar', accountHolderName: 'RAJESH KUMAR',
      isVerified: true, isManuallyVerified: true, referenceId: `ref_${SFX}`,
      ifscCode: 'HDFC0001234', bankName: 'HDFC Bank', city: 'Hyderabad',
      branchName: 'Banjara Hills', isActive: true,
      razorpayContactId: `cont_${SFX}`, razorpayFundAccountId: `fa_${SFX}`,
    }, { transaction: t });

    // ---- 4. Wallets for both users --------------------------------------
    const [hostWallet] = await Wallet.findOrCreate({
      where: { userId: hostUser.id },
      defaults: { userId: hostUser.id, walletPoints: 250, maxWalletPoints: 2000 },
      transaction: t,
    });
    const [renterWallet] = await Wallet.findOrCreate({
      where: { userId: renterUser.id },
      defaults: { userId: renterUser.id, walletPoints: 500, referralPoints: 500, maxWalletPoints: 2000 },
      transaction: t,
    });

    // ---- 5. Pickup point + Vehicle + sub-tables -------------------------
    const pickup = await Pickup.create({
      name: 'Jubilee Hills Pickup Hub', cityId: city.id, hostId: host.id,
      address: 'Road No. 36, Jubilee Hills, Hyderabad', lat: 17.4239, long: 78.4083,
    }, { transaction: t });

    const vehicle = await Vehicle.create({
      pickupId: pickup.id, vehicleNumber: 'TS09FA1234',
      vehicleName: 'Hyundai Creta SX', vehicleYear: 2022,
      vehicleRcNumber: 'RC-TS09FA1234', vehicleRcVerified: true,
      vehicleBrand: brand.id, vehicleType: 'SUV', vehicleCc: 1497,
      vehicleTransmission: 'automatic', vehicleFuelType: 'Petrol', vehicleSeats: 5,
      deposit: 3999, totalRides: 42, totalKms: 38500,
      ownerType: 1, hostId: host.id,
      reviews: 12, rating: 4.6, totalReviews: 12,
      description: 'Well-maintained Hyundai Creta SX with sunroof and cruise control.',
      active: true, features: 'Sunroof,Cruise Control,Reverse Camera,Bluetooth',
      isLuxury: false, isDeliveryAvailable: true, isPickupAvailable: true,
      rcVerified: true, isAdminApproved: true,
    }, { transaction: t });

    // Close the pickup <-> vehicle loop.
    await pickup.update({ vehicleId: vehicle.id }, { transaction: t });

    await Image.bulkCreate([
      { vehicleId: vehicle.id, isCover: true, url: 'https://picsum.photos/seed/creta1/800/600', type: 'front' },
      { vehicleId: vehicle.id, url: 'https://picsum.photos/seed/creta2/800/600', type: 'back' },
      { vehicleId: vehicle.id, url: 'https://picsum.photos/seed/creta3/800/600', type: 'driverSide' },
      { vehicleId: vehicle.id, url: 'https://picsum.photos/seed/creta4/800/600', type: 'passengerSide' },
    ], { transaction: t });

    await VehiclePlan.create({
      vehicleId: vehicle.id, kmAlloted: 300, extraKmFee: 8, perHourFee: 120,
      weekdayFee: 2200, weekendFee: 2600,
      startTime: moment().startOf('day').toDate(),
      endTime: moment().endOf('day').toDate(),
    }, { transaction: t });

    await VehiclePreference.create({
      vehicleId: vehicle.id, hostId: host.id,
      midnightBooking: false, selfPickup: true, deliverAvailable: true,
    }, { transaction: t });

    const schedule = await Schedule.create({
      vehicleId: vehicle.id,
      startTime: moment().subtract(30, 'days').toDate(),
      endTime: moment().add(60, 'days').toDate(),
      status: 'available',
    }, { transaction: t });

    await ScheduleBlock.create({
      vehicleId: vehicle.id, scheduleId: schedule.id,
      startTime: moment().subtract(10, 'days').toDate(),
      endTime: moment().subtract(9, 'days').toDate(),
      status: 'booked',
    }, { transaction: t });

    // ---- 6. Membership for the renter -----------------------------------
    const membershipTxn = await Transaction.create({
      orderId: `order_mem_${SFX}`, paymentId: `pay_mem_${SFX}`,
      paymentMethod: 'upi', userId: renterUser.id, amount: 1499,
      type: TRANSACTION_TYPE_MEMBERSHIP,
      initiatedTime: moment().subtract(20, 'days').toDate(),
      executedTime: moment().subtract(20, 'days').toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    await Membership.create({
      membershipTypeId: membershipType.id, transactionId: membershipTxn.id,
      userId: renterUser.id, amount: 1499,
      initiatedTime: moment().subtract(20, 'days').toDate(),
      startingTime: moment().subtract(20, 'days').toDate(),
      endingTime: moment().add(345, 'days').toDate(),
      freeRideLimit: 12, freeRideLimitUsed: 1,
      freeDeliveryLimit: 6, freeDeliveryLimitUsed: 1,
      status: MEMBERSHIP_SUBSCRIBED,
    }, { transaction: t });

    // ---- 7. The completed booking ---------------------------------------
    const bookingStart = moment().subtract(10, 'days').hour(10).minute(0).second(0);
    const bookingEnd = moment(bookingStart).add(24, 'hours');

    const convenienceFee = 199;
    const protectionPlanFee = 149;
    const deliveryFee = 0;
    const totalAmount = 2400; // base fare for 24h rental

    const bookingTxn = await Transaction.create({
      orderId: `order_bk_${SFX}`, paymentId: `pay_bk_${SFX}`,
      paymentMethod: 'card', userId: renterUser.id, amount: totalAmount,
      type: TRANSACTION_TYPE_BOOKING,
      initiatedTime: bookingStart.toDate(), executedTime: bookingStart.toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    const booking = await Booking.create({
      bookingId: `CC${SFX}`, transactionId: bookingTxn.id,
      startTime: bookingStart.toDate(), endTime: bookingEnd.toDate(),
      pickupTime: moment(bookingStart).add(6, 'minutes').toDate(),
      dropTime: moment(bookingEnd).add(25, 'minutes').toDate(),
      address: 'Road No. 36, Jubilee Hills, Hyderabad', lat: '17.4239', lng: '78.4083',
      startKms: 38500, startFuel: 80, startImage: 'https://picsum.photos/seed/start/600',
      endKms: 38712, endFuel: 55, endImage: 'https://picsum.photos/seed/end/600',
      delayedBy: 25, delayReason: 'Traffic on return',
      convenienceFee, protectionPlanFee, protectionPlan: protectionPlan.id,
      deliveryFee, deliveryType: 'self',
      rideType: 1, kmAlloted: 300, extraKmFee: 8,
      totalAmount, WalletPointsAwarded: 50, walletPointsUsed: 0,
      depositAmount: 3999, userId: renterUser.id, vehicleId: vehicle.id, hostId: host.id,
      paymentType: 'online', bookingType: 'online',
      status: BOOKING_FINISHED,
      startOtp: 4821, endOtp: 7390, startOtpVerified: true, endOtpVerified: true,
    }, { transaction: t });

    await Image.bulkCreate([
      { bookingId: booking.id, url: 'https://picsum.photos/seed/bkstart/800/600', isStartImage: true, type: 'fuelOdometer' },
      { bookingId: booking.id, url: 'https://picsum.photos/seed/bkend/800/600', isEndImage: true, type: 'fuelOdometer' },
    ], { transaction: t });

    // ---- 8. Review + host review ----------------------------------------
    await Review.create({
      totalRating: 5, cleanlinessRating: 5, comfortRating: 5, hostRating: 5, handlingRating: 4,
      userId: renterUser.id, vehicleId: vehicle.id, bookingId: booking.id,
      comment: 'Spotless car, smooth drive and a very courteous host. Would book again!',
    }, { transaction: t });

    await HostReview.create({
      totalRating: 5, hostId: host.id, userId: renterUser.id,
      vehicleId: vehicle.id, bookingId: booking.id,
      comment: 'Great renter — returned the car clean and on time.',
    }, { transaction: t });

    // ---- 9. Extension, reschedule, due, damage --------------------------
    const extensionTxn = await Transaction.create({
      orderId: `order_ext_${SFX}`, paymentId: `pay_ext_${SFX}`, paymentMethod: 'upi',
      userId: renterUser.id, amount: 600, type: TRANSACTION_TYPE_EXTENSION,
      initiatedTime: moment(bookingEnd).subtract(3, 'hours').toDate(),
      executedTime: moment(bookingEnd).subtract(3, 'hours').toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    await Extension.create({
      userId: renterUser.id, bookingId: booking.id, transactionId: extensionTxn.id,
      existingEndTime: bookingEnd.toDate(),
      extendedEndTime: moment(bookingEnd).add(3, 'hours').toDate(),
      extendedHours: 3, status: EXTENSION_DONE,
    }, { transaction: t });

    const rescheduleTxn = await Transaction.create({
      orderId: `order_res_${SFX}`, paymentId: `pay_res_${SFX}`, paymentMethod: 'upi',
      userId: renterUser.id, amount: 149, type: TRANSACTION_TYPE_RESCHEDULE,
      initiatedTime: moment(bookingStart).subtract(2, 'days').toDate(),
      executedTime: moment(bookingStart).subtract(2, 'days').toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    await Reschedule.create({
      userId: renterUser.id, bookingId: booking.id, transactionId: rescheduleTxn.id,
      rescheduledFrom: moment(bookingStart).subtract(1, 'day').toDate(),
      rescheduledTo: bookingStart.toDate(), status: RESCHEDULE_DONE,
    }, { transaction: t });

    const dueTxn = await Transaction.create({
      orderId: `order_due_${SFX}`, paymentId: `pay_due_${SFX}`, paymentMethod: 'upi',
      userId: renterUser.id, amount: 320, type: TRANSACTION_TYPE_DUE,
      initiatedTime: moment(bookingEnd).add(1, 'day').toDate(),
      executedTime: moment(bookingEnd).add(1, 'day').toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    await Due.create({
      userId: renterUser.id, bookingId: booking.id, orderId: `order_due_${SFX}`,
      transactionId: dueTxn.id, totalAmount: 320,
      reason: 'Extra 12 km beyond allotted limit @ ₹8/km + late-return fee',
      status: DUE_PAID, dueType: 'shared', hostAmount: 160,
    }, { transaction: t });

    const damageTxn = await Transaction.create({
      orderId: `order_dmg_${SFX}`, paymentId: `pay_dmg_${SFX}`, paymentMethod: 'card',
      userId: renterUser.id, amount: 1500, type: TRANSACTION_TYPE_DUE,
      initiatedTime: moment(bookingEnd).add(2, 'days').toDate(),
      executedTime: moment(bookingEnd).add(2, 'days').toDate(),
      paymentStatus: TRANSACTION_PAID,
    }, { transaction: t });

    await Damage.create({
      bookingId: booking.id, damageType: 'Minor scratch', damagedPart: 'Rear bumper',
      damageDescription: 'Two small scratches on the rear-left bumper.',
      damageImage: 'https://picsum.photos/seed/damage/800/600',
      damageStatus: 'paid', damageAmount: 1500, transactionId: damageTxn.id,
      damageDate: moment(bookingEnd).add(1, 'day').toDate(),
    }, { transaction: t });

    // ---- 10. Refund (partial, on the booking) ---------------------------
    await Refund.create({
      paymentId: `pay_bk_${SFX}`, transactionId: bookingTxn.id, bookingId: booking.id,
      acquirer: 'razorpay', amount: 200,
      initiatedTime: moment(bookingEnd).add(1, 'day').toDate(),
      executedTime: moment(bookingEnd).add(2, 'days').toDate(),
      status: REFUND_PROCESSED,
    }, { transaction: t });

    // ---- 11. Host payout ledger + invoice (mirrors payoutService logic) --
    const extensionAmount = 600;
    const dueHostShare = 160; // shared due -> host's cut
    const commissionPct = Number(hostCommission.commissionPercentage);
    const gstPct = 5.0;

    const initialBookingAmount = totalAmount;
    const totalGrossAmount = initialBookingAmount + extensionAmount + dueHostShare;
    const commissionableAmount = totalGrossAmount - (convenienceFee + deliveryFee + protectionPlanFee);
    const commissionAmount = Math.round(commissionableAmount * (commissionPct / 100));
    const hostNetAmount = totalGrossAmount - commissionAmount;
    const gstAmount = Math.round(hostNetAmount * (gstPct / 100));
    const hostPayableAmount = hostNetAmount + gstAmount;

    const ledger = await HostPayoutLedger.create({
      hostId: host.id, bookingId: booking.id,
      initialBookingAmount, extensionAmount, dueAmount: dueHostShare,
      totalGrossAmount, convenienceFee, deliveryFee, protectionPlanFee,
      commissionPercentage: commissionPct, commissionableAmount, commissionAmount,
      hostNetAmount, gstPercentage: gstPct, gstAmount, hostPayableAmount,
      hostCommissionId: hostCommission.id, payoutStatus: 'completed',
      razorpayTransferId: `trf_${SFX}`, payoutDate: moment().subtract(2, 'days').toDate(),
    }, { transaction: t });

    const invoice = await HostInvoice.create({
      hostId: host.id, payoutLedgerId: ledger.id,
      invoiceNumber: `INV-HOST-${SFX}`,
      invoiceDate: moment().subtract(2, 'days').toDate(),
      dueDate: moment().add(5, 'days').toDate(),
      lineItems: [
        { bookingId: booking.id, description: 'Rental payout (Hyundai Creta SX, 24h)', amount: initialBookingAmount },
        { bookingId: booking.id, description: 'Extension payout (3h)', amount: extensionAmount },
        { bookingId: booking.id, description: 'Shared due (host share)', amount: dueHostShare },
      ],
      subtotal: hostNetAmount, taxAmount: gstAmount, totalAmount: hostPayableAmount,
      gstNumber: '36ABCDE1234F1Z5', gstRate: gstPct,
      commissionPercentage: commissionPct, commissionAmount,
      status: 'paid', notes: 'Auto-generated payout invoice.',
    }, { transaction: t });

    await ledger.update({ invoiceId: invoice.id }, { transaction: t });

    // ---- 12. Conversation + messages ------------------------------------
    const conversation = await Conversation.create({
      bookingId: booking.id, hostId: hostUser.id, userId: renterUser.id,
      isClosed: true,
    }, { transaction: t });

    await Message.bulkCreate([
      {
        conversationId: conversation.id, senderId: renterUser.id, type: 'rich_text',
        content: { text: 'Hi! Is the Creta available for pickup at 10 AM sharp?' },
        timestamp: moment(bookingStart).subtract(1, 'hour').toDate(),
      },
      {
        conversationId: conversation.id, senderId: hostUser.id, type: 'rich_text',
        content: { text: 'Yes Ananya, it is fuelled and ready. See you at the hub.' },
        timestamp: moment(bookingStart).subtract(50, 'minutes').toDate(),
      },
      {
        conversationId: conversation.id, senderId: renterUser.id, type: 'image',
        content: { url: 'https://picsum.photos/seed/handover/600/400', caption: 'Handover photo' },
        timestamp: moment(bookingEnd).add(30, 'minutes').toDate(),
      },
    ], { transaction: t });

    // ---- 13. Wallet transactions ----------------------------------------
    await WalletTransaction.bulkCreate([
      {
        userId: renterUser.id, walletId: renterWallet.id, points: 500,
        description: 'Referral bonus for signing up with RAJESH code', isCredit: true, status: 'success',
      },
      {
        userId: renterUser.id, walletId: renterWallet.id, points: 50,
        description: `Reward for completed booking CC${SFX}`, isCredit: true, status: 'success',
      },
      {
        userId: hostUser.id, walletId: hostWallet.id, points: 250,
        description: 'Host onboarding bonus', isCredit: true, status: 'success',
      },
    ], { transaction: t });

    // ---- 14. FCM tokens --------------------------------------------------
    await FcmToken.bulkCreate([
      { token: `fcm_host_${SFX}`, userId: hostUser.id, deviceId: `dev_host_${SFX}` },
      { token: `fcm_renter_${SFX}`, userId: renterUser.id, deviceId: `dev_renter_${SFX}` },
    ], { transaction: t });

    // ---- 15. Admin + Influencer -----------------------------------------
    await Admin.create({
      uid: `admin_${SFX}`, name: 'Ops Admin', mobile: '+919000000099',
      email: `admin.${SFX}@cocarr.in`, cityId: city.id, role: 1, isActive: true,
      lastActivity: new Date(),
    }, { transaction: t });

    await Influencer.create({
      name: 'Priya Reddy', email: `priya.reddy.${SFX}@example.com`,
      referral_code: `PRIYA${SFX}`, commission_percent: 8.0,
    }, { transaction: t });

    await t.commit();
    console.log('Core data committed successfully.\n');

    // ---- 16. Legacy integer-keyed tables (best-effort) ------------------
    // These columns are typed INTEGER but nominally reference UUID keys, so we
    // seed them outside the main transaction and tolerate failure.
    await bestEffort('offerCities', () => OfferCities.create({ cityId: 1, offerId: 1 }));
    await bestEffort('offerUsage', () => OfferUsage.create({ offerId: 1, offerAmount: 300.0, userId: 1, bookingId: 1 }));

    // Referral module: both demo users are active, so each has an ACTIVE
    // shareable code, and the renter is recorded as referred by the host with
    // the sign-up reward already credited (the state after activation).
    await bestEffort('referral codes', async () => {
      await ReferralCode.create({ userId: hostUser.id, code: `RAJESH${SFX}`.slice(0, 12), status: 'active', activatedAt: new Date(), totalReferrals: 1, totalPointsEarned: 100 });
      await ReferralCode.create({ userId: renterUser.id, code: `ANANYA${SFX}`.slice(0, 12), status: 'active', activatedAt: new Date() });
      await Referral.create({
        referrerId: hostUser.id, refereeId: renterUser.id, referralCode: `RAJESH${SFX}`.slice(0, 12),
        status: 'eligible', rewardStatus: 'partial', signupRewarded: true,
        rewardPointsReferrer: 100, rewardPointsReferee: 100,
      });
    });

    console.log('\n✅ Seeding complete.');
    console.log(`   Booking CC${SFX} | Host ${host.id} | Vehicle ${vehicle.id}`);
  } catch (err) {
    await t.rollback();
    console.error('\n❌ Seeding failed — transaction rolled back.');
    throw err;
  }
}

async function bestEffort(label, fn) {
  try {
    await fn();
    console.log(`  seeded ${label}`);
  } catch (e) {
    console.warn(`  skipped ${label}: ${e.message}`);
  }
}

main()
  .then(() => db.close())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    db.close().finally(() => process.exit(1));
  });
