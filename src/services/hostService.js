const crypto = require('crypto');
const { CustomError } = require('../middlewares/error');
const Host = require('../models/host');
const User = require('../models/user');
const Booking = require('../models/booking');
const Vehicle = require('../models/vehicle');
const Brand = require('../models/brand');
const Pickup = require('../models/pickuppoint');
const VehiclePlan = require('../models/vehicleplan');
const { Op, Sequelize } = require('sequelize');
const Image = require('../models/image');
const City = require('../models/city');
const Review = require('../models/review');
const Transaction = require('../models/transaction');
const Schedule = require('../models/schedule');
const ScheduleBlock = require('../models/scheduleBlock');
const Damage = require('../models/damage');
const db = require('../configs/db');
const documentStore = require('./documentStoreService');
const KycDocument = require('../models/kycDocument');
const PanCard = require('../models/panCard');
const DrivingLicence = require('../models/drivingLicence');
const { default: axios } = require('axios');
const VehiclePreference = require('../models/vehiclePreference');
const { BOOKING_FINISHED, BOOKING_INITIATED, BOOKING_BOOKED, BOOKING_CANCELLED, BOOKING_ONGOING } = require('../configs/constants');
const HostReview = require('../models/hostReview');
const HostPayoutAccount = require('../models/hostPayoutAccount');
const HostCommission = require('../models/hostCommission');
const Wallet = require('../models/wallet');
const WalletTransaction = require('../models/wallettransaction');
const moment = require('moment');
const VehicleRcDocument = require('../models/vehicleRcDocument');
const { refundSummary } = require('./bookingService');
const { createRazorpayLinkedAccount } = require('./paymentGatewayService');
const imageService = require('./imageService');
const { kycHttp } = require('../utils/kycHttp');
const { getSignature } = require("../utils/signature");

const createHost = async (hostData) => {
  const transaction = await db.transaction();
  try {
    const userInfo = await User.findOne({ where: { id: hostData.userId } });
    if (!userInfo) throw new CustomError('User not found', 404);
    
    const host = await Host.create({
      userId: hostData.userId,
      name: userInfo.name,
      email: userInfo.email,
      contactNumber: userInfo.contactNumber,
      countryCode: userInfo.countryCode
    }, { transaction });

    // Create default 30% commission for the host
    await HostCommission.create({
      hostId: host.id,
      commissionPercentage: 30.00,
      startDate: new Date(),
      isActive: true
    }, { transaction });

    await transaction.commit();
    return host;
  } catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};

// Sortable columns, so a client cannot put arbitrary text into ORDER BY.
const HOST_SORTABLE = ['createdAt', 'updatedAt', 'name', 'email', 'contactNumber', 'status'];

// Per-page verification summary for a set of hosts, resolved from the USER's
// documents (see getHostById for why the host's own kyc* columns are dead).
//
// One query per document type for the whole page rather than three per host —
// a list of 25 costs 3 queries, not 75. Only `isCurrent` rows are considered,
// which is the same rule documentStore.getCurrent applies: a superseded
// submission must not decide the badge.
async function attachVerificationSummary(hosts) {
  const rows = hosts.map((h) => (h.toJSON ? h.toJSON() : h));
  const userIds = [...new Set(rows.map((h) => h.userId).filter(Boolean))];
  if (!userIds.length) return rows;

  const where = { userId: { [Op.in]: userIds }, isCurrent: true };
  const pick = ['userId', 'status'];
  const [kyc, pan, licence] = await Promise.all([
    KycDocument.findAll({ where, attributes: pick }),
    PanCard.findAll({ where, attributes: pick }),
    DrivingLicence.findAll({ where, attributes: pick }),
  ]);

  const index = (list) => Object.fromEntries(list.map((d) => [d.userId, d.status]));
  const byUser = { kyc: index(kyc), pan: index(pan), licence: index(licence) };

  // `null` means NOT SUBMITTED and is deliberately distinct from 'pending'.
  // Collapsing them would tell an admin somebody is awaiting review when they
  // have not sent anything — two states, two different actions.
  return rows.map((h) => ({
    ...h,
    verification: {
      source: 'user',
      kycStatus: byUser.kyc[h.userId] ?? null,
      panStatus: byUser.pan[h.userId] ?? null,
      licenceStatus: byUser.licence[h.userId] ?? null,
    },
  }));
}

const getAllHosts = async ({sort,offset=0,limit=10,filter,search}) => {
  try {
    // `sort` was read straight off req.query and dereferenced — so ANY caller
    // omitting it got `Cannot read properties of undefined (reading
    // 'startsWith')`, surfaced as a bare 400. The ops list happens to always
    // send one, which is why this survived. Default, and refuse a column that
    // is not sortable rather than interpolating it into ORDER BY.
    const requested = String(sort || '-createdAt');
    const direction = requested.startsWith('-') ? 'DESC' : 'ASC';
    const column = requested.replace(/^-/, '');
    const order = [[HOST_SORTABLE.includes(column) ? column : 'createdAt', direction]];

    // `search` USED TO DO NOTHING. It was passed to findAndCountAll as
    // `search:`, which Sequelize does not understand and silently ignores — so
    // the ops search box filtered nothing and quietly returned page 1 of
    // everything. Hosts carry their own denormalised name/email/contactNumber,
    // so the match is a plain OR across those three.
    const term = String(search || '').trim();
    const where = { ...(filter || {}) };
    if (term) {
      where[Op.or] = [
        { name: { [Op.like]: `%${term}%` } },
        { email: { [Op.like]: `%${term}%` } },
        { contactNumber: { [Op.like]: `%${term}%` } },
      ];
    }

    const { count, rows } = await Host.findAndCountAll({
      where,
      order,
      offset: isNaN(offset) ? 0 : parseInt(offset),
      limit: isNaN(limit) ? 10 : parseInt(limit),
    });

    // THE LIST'S KYC COLUMN WAS ALWAYS FALSE. `hosts.kycVerified` is never
    // written by anything (see getHostById), so every host rendered as
    // unverified — including hosts whose user holds a verified Aadhaar. The
    // real state is on the user's documents, so resolve it for this PAGE.
    //
    // Resolved in BULK, not per row: three queries for the whole page instead
    // of three per host. At the default limit that is 3 queries rather than 75.
    const data = await attachVerificationSummary(rows);

    return {
      data,
      totalCount: count
    };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
}
const checkHost = async (hostData) => {
  try {
    return await Host.findOne({ where: { userId: hostData.userId } }) ? { isHost: true } : { isHost: false };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const getHostPayoutBankAccount = async (hostId) => {
  try {
    let host = await Host.findOne({where:{userId:hostId}});
    let account = await HostPayoutAccount.findOne({ where: { hostId: host.id,isActive:true } });
    return account;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
}

const createHostPayoutBankAccount = async (hostId, data) => {
  try {
    const host = await Host.findOne({ where: { userId: hostId }, include: [{ model: User, as: 'user' }] });
    if (!host) throw new CustomError('Host not found', 404);
    if (!data.accountNumber || !data.ifscCode || !data.hostProvidedName) throw new CustomError('All fields are required', 400);

    // Verify bank account details with KYC provider
    let kycResponse = await axios.post(`${process.env.KYC_URL}/verification/bank-account/sync`, {
      bank_account: data.accountNumber,
      ifsc: data.ifscCode,
      name: data.hostProvidedName
    }, {
      headers: {
        'x-client-id': `${process.env.KYC_ID}`,
        'x-client-secret': `${process.env.KYC_SECRET}`
      }
    });

    if (kycResponse.data.status === 'INVALID') throw new CustomError('Bank account is not valid', 400);
    if (kycResponse.data.name_match_result === 'NO_MATCH') throw new CustomError('Account Holder Name does not match', 400);

    // Check for existing active account
    const existingAccount = await HostPayoutAccount.findOne({ where: { hostId: host.id, isActive: true } });

    if (existingAccount) {
      const accountCreatedAt = new Date(existingAccount.createdAt);
      const currentTime = new Date();
      const timeDifference = (currentTime - accountCreatedAt) / (1000 * 60 * 60); // Convert milliseconds to hours

      if (timeDifference > 72) {
        await existingAccount.update({ isActive: false });
      } else {
        throw new CustomError('Updating account within the 72 hours is not allowed', 400);
      }
    }

    // Prepare host data for Razorpay linked account creation
    const hostData = {
      id: host.id,
      userId: hostId,
      email: host.email || host.user?.email,
      contactNumber: host.contactNumber || host.user?.contactNumber,
      address: host.address || null,
      panNumber: host.panNumber || null,
      gstNumber: host.gstNumber || null
    };

    // Extract last 4 digits of account number
    const last4Digits = data.accountNumber.slice(-4);

    // SAVE FIRST, LINK SECOND. THE ORDER WAS THE OTHER WAY AND IT LOST DATA.
    //
    // `createRazorpayLinkedAccount` was awaited BEFORE this row was created, and
    // it throws on every failure path — Route not enabled on the merchant
    // account, a stakeholder or product-config rejection, and a plain
    // TypeError when Cashfree's response carries no `ifsc_details`. Any of
    // those discarded the host's bank details ENTIRELY, after we had already
    // paid for a real verification against them. The host was told "try again"
    // and had to re-enter and re-verify, with nothing to show they had ever
    // submitted. That is exactly the state dev is in: a host, a verified
    // identity, and zero rows in hostPayoutAccounts.
    //
    // The bank details are OURS and the verification is the thing worth
    // keeping. The gateway linkage is a downstream integration that can be
    // retried, so it must not be able to destroy the record it decorates.
    const account = await HostPayoutAccount.create({
      hostId: host.id,
      accountNumber: last4Digits, // Only store last 4 digits
      accountHolderName: kycResponse.data.name_at_bank,
      ifscCode: data.ifscCode,
      bankName: kycResponse.data.bank_name,
      isVerified: true,
      isManuallyVerified: false,
      referenceId: kycResponse.data.reference_id,
      city: kycResponse.data.city,
      utrNumber: kycResponse.data.utr_number,
      branchName: kycResponse.data.branch_name,
      micrCode: kycResponse.data.micr_code,
      nameMatchScore: kycResponse.data.name_match_score,
      nameMatchStatus: kycResponse.data.name_match_status,
      hostProvidedName: data.hostProvidedName,
      isActive: true
    });

    // Best effort, and deliberately not fatal. An unlinked account cannot be
    // PAID (settlement resolves the gateway ids), which is the correct
    // consequence — but it is a retryable state with the details on file, not
    // a lost submission. The failure is logged loudly because nothing else
    // surfaces it yet.
    try {
      const razorpayAccount = await createRazorpayLinkedAccount(
        hostData,
        kycResponse.data,
        data.accountNumber,
        data.ifscCode
      );
      await account.update({
        razorpayContactId: razorpayAccount.linkedAccountId,
        razorpayFundAccountId: razorpayAccount.stakeholderId,
      });
    } catch (linkError) {
      console.error(
        `[payout] Bank account ${account.id} saved and VERIFIED, but the Razorpay linked account failed: `
        + `${linkError?.message || linkError}. Payouts to this host are blocked until it is linked; `
        + 'the host does NOT need to re-enter their details.',
      );
    }

    return account;
  } catch (error) {
    throw new CustomError(error.message, error.statusCode || 400);
  }
}

// A HOST'S KYC IS THE USER'S KYC. There is no second identity to verify.
//
// `hosts` still declares kycNumber / kycRef / kycImage / kycVerified, and
// NOTHING HAS EVER WRITTEN THEM — no host is created with them, no flow updates
// them, and the one host on dev has kycVerified=0 and kycNumber=NULL while the
// user behind it holds a verified Aadhaar, a PAN and a licence. Any screen
// reading those columns therefore shows "not verified" about somebody who is,
// and would send an admin to re-collect documents that are already on file.
//
// The real documents live in kycDocuments / panCards / drivingLicences, keyed by
// USER id — which is already the shareable model the platform wants: the same
// person books rides and lists cars, verifies once, and both roles are covered.
// This resolves them for the host's user and returns them under `verification`,
// so the host screens read the same rows the user screens do rather than a
// parallel copy that can disagree.
//
// The legacy columns stay in the response for now (dropping them is a
// migration), but they are dead — read `verification`, never `host.kyc*`.
const getHostById = async (id) => {
  try {
    const host = await Host.findByPk(id, {
      include: [{ model: User, as: 'user' }, { model: HostPayoutAccount, as: 'hostPayoutAccount' }],
    });
    if (!host) return null;

    const json = host.toJSON();
    if (json.userId) {
      const docs = await documentStore.getAllForUser(json.userId);
      json.verification = {
        ...documentStore.projectUserDocuments(docs),
        // The PROFILE's position in the review workflow, which is what actually
        // gates booking — distinct from any individual document's status.
        verificationStatus: json.user?.verificationStatus ?? null,
        // Says out loud where these came from, so a reader is never left
        // wondering whether the host has a separate submission somewhere.
        source: 'user',
        userId: json.userId,
      };
    }
    return json;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const updateHost = async (id, hostData) => {
  try {
    const host = await Host.findByPk(id);
    if (!host) return null;
    return await host.update(hostData);
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const getHostBookings = async ({ userId, offset=0, limit=10, sortBy='-createdAt', status='', vehicleId='' }) => {
  try {
    const host = await Host.findOne({ where: { userId: userId } });
    if (!host) throw new CustomError('Host not found', 404);

    const orderDirection = sortBy.startsWith('-') ? 'DESC' : 'ASC';
    const orderColumn = sortBy.startsWith('-') ? sortBy.substring(1) : sortBy;
    let whereClause = {
      // status: { [Op.ne]: BOOKING_INITIATED } // Filter out bookings with status 'initiated'
    };
    if (status && status !== '') {
      whereClause.status = status;
    }
    if(vehicleId && vehicleId !== ''){
      whereClause.vehicleId = vehicleId;
    }

    let totalBookings = await Booking.count({
      where: whereClause,
      include: [
        {
          model: Vehicle,
          as: 'vehicle',
          where: { hostId: host.id }
        }
      ]
    });

    let bookings = await Booking.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'user',
        },
        {
          model: Vehicle,
          as: 'vehicle',
          where: { hostId: host.id },
          include: [{ model: Image, as: 'images' }]
        },
        {
          model: Review,
          as: 'review'
        },
        {
          model: HostReview,
          as: 'hostReview'
        },
        {
          model: Damage,
          as: 'damages'
        },
        {
          model: Transaction,
          as: 'transaction'
        }
      ],
      order: [[orderColumn, orderDirection]],
      limit: isNaN(limit) ? 10 : parseInt(limit),
      offset: isNaN(offset) ? 0 : parseInt(offset)
    });

    return { bookings, count: totalBookings };
  } catch (error) {
    console.log(error.message);
    throw new CustomError(error.message, 400);
  }
};

const getHostBookingById = async (id) => {
  try {
    const booking = await Booking.findByPk(id,{include:[{model:User,as:'user'},{model:Damage,as:'damages'},{model:Image,as:'images'},{model:HostReview,as:'hostReview'},{model:Vehicle,as:'vehicle',include:[{model:Image,as:'images',model:Brand,as:'brand'},{model:Pickup,as:'pickupPoint',include:{model:City,as:'city'}}]},{model:Review,as:'review'},{model:Transaction,as:'transaction'}]});
    if(!booking) throw new CustomError('Booking not found', 404);

    // Check if booking endTime is within 48 hours from now
    const now = new Date();
    const dropTime = new Date(booking.endTime);
    const hoursDiff = Math.abs(dropTime - now) / 36e5; // Convert ms to hours
    const isAllowedForReport = hoursDiff <= 240 && booking.status === BOOKING_FINISHED;

    return {
      ...booking.toJSON(),
      isAllowedForReport : isAllowedForReport && booking.damages.length === 0,
    };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const cancelBooking = async (bookingId, data) => {
  const transaction = await db.transaction();
  try {
    const booking = await Booking.findByPk(bookingId, { transaction });
    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }

    booking.cancelledBy = 2;
    booking.cancelReason = data.reason;
    booking.status = BOOKING_CANCELLED;
    await booking.save({ transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};

const startBooking = async (bookingId, data) => {
  const transaction = await db.transaction();
  try {
    const booking = await Booking.findByPk(bookingId, { transaction });
    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }

    if(booking.status !== BOOKING_BOOKED){
      throw new CustomError('Booking is not booked', 400);
    }
    if(!data.startKms){
      throw new CustomError('Start Kms is required', 400);
    }
    if(!data.startFuel){
      throw new CustomError('Start Fuel is required', 400);
    }
    if(!data.startImages || data.startImages.length === 0){
      throw new CustomError('Start Image is required', 400);
    }

    // Capture only. The ride does not start here: the host records the
    // handover readings, then the rider enters the start OTP on their own
    // device (POST /booking/start-ride), which is what flips the status.
    // Entering it here would be meaningless — the host is the one the code is
    // displayed to.
    

    booking.pickupTime = new Date(data.startDateTime);
    booking.startKms = data.startKms;
    booking.startFuel = data.startFuel;
    booking.startCapturedAt = new Date();
    // Status deliberately stays BOOKED. Wallet points are awarded by
    // bookingService.startRide when the ride actually starts, so they can't be
    // credited twice.
    await booking.save({ transaction });

    if (data.startImages) {
      const { front, back, driverSide, passengerSide, userWithCar, fuelOdometer } = data.startImages;
      const allImages = [
        { url: front, bookingId: booking.id, isCover: false, isStartImage: true, type: 'front' },
        { url: back, bookingId: booking.id, isCover: false, isStartImage: true, type: 'back' },
        { url: driverSide, bookingId: booking.id, isCover: false, isStartImage: true, type: 'driverSide' },
        { url: passengerSide, bookingId: booking.id, isCover: false, isStartImage: true, type: 'passengerSide' },
        { url: userWithCar, bookingId: booking.id, isCover: false, isStartImage: true, type: 'userWithCar' },
        { url: fuelOdometer, bookingId: booking.id, isCover: false, isStartImage: true, type: 'fuelOdometer' }
      ].filter(img => img.url !== null);

      if (allImages.length === 0) {
        throw new CustomError('At least one image is required', 400);
      }

      await Image.bulkCreate(allImages, { transaction });
    } else {
      throw new CustomError('Images data is required', 400);
    }

    await transaction.commit();
} catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};


const createHostReview = async (bookingId, data) => {
  const transaction = await db.transaction();
  try {
    const booking = await Booking.findByPk(bookingId, {include:[{model:HostReview,as:'hostReview'}]}, { transaction });
    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }
    if(booking.hostReview){
      throw new CustomError('Host review already exists', 400);
    }
    const hostReview = await HostReview.create({bookingId,totalRating:data.totalRating,comment:data.comment,userId:booking.userId,vehicleId:booking.vehicleId,hostId:booking.hostId});  
    await transaction.commit()
    return hostReview;
  } catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};

const endBooking = async (bookingId, data) => {
  const transaction = await db.transaction();
  try {
    const booking = await Booking.findByPk(bookingId, { transaction });
    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }

    // This had no status guard at all, so a booking that was never started —
    // or one already finished — could be "ended".
    if (booking.status !== BOOKING_ONGOING) {
      throw new CustomError('Ride is not ongoing', 400);
    }
    if (!data.endKms) {
      throw new CustomError('End Kms is required', 400);
    }

    // Capture only — same handshake rule as the start. The rider closes the
    // ride out by entering the end OTP on their own device.
    booking.dropTime = new Date(data.endDateTime);
    booking.endKms = data.endKms;
    booking.endFuel = data.endFuel;
    booking.endCapturedAt = new Date();
    await booking.save({ transaction });

    if (data.endImages && data.endImages.length > 0) {
      const allImages = data.endImages.map(image => ({ url: image.url, bookingId: booking.id, isCover: false, isEndImage: true }));
      await Image.bulkCreate(allImages, { transaction });
    } else {
      throw new CustomError('Images data is required', 400);
    }

    const startTime = moment(booking.startTime);
    const endTime = moment(booking.endTime);
    const hoursBooked = Math.ceil(endTime.diff(startTime, 'hours', true));
    const points = hoursBooked * 10;

    // // Find or create wallet and add points
    // let wallet = await Wallet.findOne({ where: { userId: booking.userId } });
    // if (!wallet) {
    //   wallet = await Wallet.create({ userId: booking.userId, walletPoints: 0 });
    // }
    // wallet.walletPoints += points;
    // await wallet.save();

    // // Create wallet transaction
    // await WalletTransaction.create({
    //   userId: booking.userId,
    //   walletId: wallet.id,
    //   points: points,
    //   description: `Points for the ride #${booking.bookingId}`,
    //   isCredit: true
    // });


    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};

const createVehicle = async ({step,vehicleNumber,brandId,cityId,vehicleName,model,userId,description,images,vehicleId:vehicleIdParam,lat,long,address,name,preferences,vehiclePlan:vehiclePlandata,rcImageUrl,rcBackImageUrl}) => {
  const transaction = await db.transaction();
  try {
    let vehicle;
    let verificationId;
    let vehicleId = vehicleIdParam || null;

    if (step === 1) {

      // Check for existing undeleted vehicle with same number (case insensitive)
      const existingVehicle = await Vehicle.findOne({
        where: {
          vehicleNumber: Sequelize.where(
            Sequelize.fn('LOWER', Sequelize.col('vehicleNumber')),
            Sequelize.fn('LOWER', vehicleNumber)
          ),
          deleted: false
        },
        transaction
      });

      if (existingVehicle) {
        throw new CustomError('Vehicle with this registration number already exists', 400);
      }

      let randomVehicleId;
      do {
        randomVehicleId = Math.floor(10000 + Math.random() * 90000);
      } while (await Vehicle.findOne({ where: { vehicleId: randomVehicleId }, transaction }));

      const host = await Host.findOne({ where: { userId: userId } });
      // Without this the next line threw "Cannot read properties of null",
      // which surfaced as an opaque 400 when adding the first car.
      if (!host) {
        throw new CustomError('Complete host onboarding before adding a car', 400);
      }
      const generateTimeUniqueId = () => {
        const timestamp = Date.now().toString(36);
        const randomString = Math.random().toString(36).substring(2, 12);
        return (timestamp + randomString).substring(0, 50);
      };

      verificationId = generateTimeUniqueId();

      // RC lookup runs when the KYC provider is configured (legacy step-wise
      // create path; the wizard uses createVehicleListing).
      let rc = null;
      if (isRcConfigured()) {
        let res;
        try {
          res = await axios.post(
            `${process.env.KYC_URL}/verification/vehicle-rc`,
            { verification_id: verificationId, vehicle_number: vehicleNumber },
            { headers: { 'x-client-id': `${process.env.KYC_ID}`, 'x-client-secret': `${process.env.KYC_SECRET}` } }
          );
        } catch (error) {
          // Provider unreachable — list the car unverified rather than failing.
          console.error('RC lookup failed during create:', error?.response?.data || error.message);
        }
        if (res) {
          rc = res.data;
          // Must be awaited — otherwise the validation throw is swallowed as an
          // unhandled rejection and invalid RCs slip through.
          await verifyVehicleRc(rc);
        }
      }

      const rcFields = rc
        ? {
            vehicleYear: rc.vehicle_manufacturing_month_year
              ? rc.vehicle_manufacturing_month_year.split('/')[1]
              : null,
            vehicleType: rc.body_type,
            vehicleCc: rc.vehicle_cubic_capacity,
            vehicleTransmission: rc.vehicleTransmission,
            vehicleFuelType: rc.type ? String(rc.type).toLowerCase() : null,
            vehicleSeats: rc.vehicle_seat_capacity,
          }
        : {};

      vehicle = await Vehicle.create({vehicleId:randomVehicleId,isDraft:true, vehicleBrand:brandId,vehicleCity:cityId,vehicleName,model,description,...rcFields,ownerType:1,hostId:host.id,vehicleNumber: rc?.vehicle_number || normalizeVehicleNumber(vehicleNumber)}, { transaction });

      // RC lives in its own table — recorded here so the draft carries its
      // provider result from the moment it is created.
      await VehicleRcDocument.create({
        vehicleId: vehicle.id,
        rcNumber: rc?.vehicle_number || normalizeVehicleNumber(vehicleNumber) || null,
        imageKey: rcImageUrl || null,
        backImageKey: rcBackImageUrl || null,
        ownerName: rc?.owner_name || null,
        makerModel: rc?.maker_model || null,
        makerDescription: rc?.maker_description || null,
        manufacturedYear: rc?.vehicle_manufacturing_month_year || null,
        colour: rc?.color || null,
        fuelType: rc?.type ? String(rc.type).toLowerCase() : null,
        engineNumber: rc?.vehicle_engine_number || null,
        chassisNumber: rc?.vehicle_chasi_number || null,
        status: 'pending',
        providerStatus: rc ? 'VERIFIED' : null,
        verificationId: verificationId || null,
        providerCheckedAt: rc ? new Date() : null,
        isCurrent: true,
      }, { transaction });
      if (!vehicle) {
        throw new CustomError('Vehicle creation failed', 400);
      }
      vehicleId = vehicle.id;
    }

    // Step 2: Create images with vehicleId
    if (step === 2) {  
      if (!vehicleId) {
        throw new CustomError('Vehicle ID is required for step 2', 400);
      }
      if (images && images.length > 0) {
        const allImages = images.map(image => ({ ...image, vehicleId }));
        await Image.bulkCreate(allImages, { transaction });
      } else {
        throw new CustomError('Images data is required', 400);
      }
    }

    // Step 3: Create Pickup Point
    if (step === 3) {
      if (!vehicleId) {
        throw new CustomError('Vehicle ID is required for step 3', 400);
      }
      const host = await Host.findOne({ where: { userId: userId } });
      const pickupPoint = await Pickup.create({vehicleId,cityId,address,lat,long,hostId:host.id}, { transaction });
      vehicle = await Vehicle.findByPk(vehicleId);
      vehicle.pickupId = pickupPoint.id;
      await vehicle.save({ transaction });
    }

    if(step === 4){
      const host = await Host.findOne({ where: { userId: userId } });
      const vehiclePreference = await VehiclePreference.create({
        vehicleId,
        hostId: host.id,
        midnightBooking: preferences.midnightBooking,
        selfPickup: preferences.selfPickup,
        deliverAvailable: preferences.deliverAvailable
      }, { transaction });

      // Stays a draft until pricing is added in step 5 — a car with no rate
      // plan can't be booked, so it shouldn't go live here.
      vehicle = await Vehicle.findByPk(vehicleId);
      await vehicle.save({ transaction });
    }

    // Step 5: Create VehiclePlan
    if (step === 5) {
      if (!vehicleId) {
        throw new CustomError('Vehicle ID is required for step 3', 400);
      }
      const host = await Host.findOne({ where: { userId: userId } });
      if (!host) {
        throw new CustomError('Complete host onboarding before adding a car', 400);
      }
      const plan = vehiclePlandata || {};
      // Accept both the documented names and the ones the app/web send.
      const weekdayFee = plan.weekdayFee ?? plan.weekdayPricing;
      const weekendFee = plan.weekendFee ?? plan.weekendPricing;
      const extraKmFee = plan.extraKmFee ?? plan.perHourFee;
      if (!plan.kmAlloted || weekdayFee == null || weekendFee == null) {
        throw new CustomError('Alloted kms and weekday/weekend pricing are required', 400);
      }
      const vehiclePlan = await VehiclePlan.create({vehicleId,kmAlloted:plan.kmAlloted,extraKmFee,weekdayFee,weekendFee,endTime:plan.endTime,hostId:host.id,startTime:plan.startTime || new Date()}, { transaction });
      vehicle = await Vehicle.findByPk(vehicleId);
      vehicle.isDraft = false;
      await vehicle.save({ transaction });
    }

    await transaction.commit();
    return vehicle;
  } catch (error) {
    await transaction.rollback();
    console.log(error)
    throw new CustomError(error.message, 400);
  }
};


const generateVerificationId = () => {
  const timestamp = Date.now().toString(36);
  const randomString = Math.random().toString(36).substring(2, 12);
  return (timestamp + randomString).substring(0, 50);
};

// Creates a complete listing in a single transaction, from the review step of
// the host wizard. The stepwise `createVehicle` wrote a row per step, which
// left half-built draft cars behind whenever a host abandoned the flow; here
// nothing is persisted until the host confirms, and any failure rolls back the
// whole listing rather than stranding it mid-way.
//
// `vehicleId` is optional and only used to finish one of those older drafts.
// The host no longer picks a brand — it is derived from the RC manufacturer
// ("HYUNDAI MOTOR INDIA LTD" → the existing "Hyundai" brand). vehicleBrand is a
// NOT NULL FK that the search filters and car cards rely on, so it must always
// resolve to a real Brand row; an unrecognised manufacturer is created rather
// than failing the listing.
const resolveBrandId = async (maker, providedBrandId) => {
  if (providedBrandId) return providedBrandId;
  const raw = String(maker || '').trim();
  if (!raw) return null;

  const brands = await Brand.findAll();
  const lower = raw.toLowerCase();
  // Longest brand name that appears in the manufacturer string wins, so
  // "Maruti Suzuki" beats a bare "Suzuki".
  const match = brands
    .filter((b) => b.name && lower.includes(String(b.name).toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (match) return match.id;

  // Fall back to the first word, e.g. "TATA MOTORS LTD" → "Tata".
  const firstWord = raw.split(/\s+/)[0];
  const byWord = brands.find((b) => String(b.name).toLowerCase() === firstWord.toLowerCase());
  if (byWord) return byWord.id;

  const [created] = await Brand.findOrCreate({
    where: { name: firstWord },
    defaults: { name: firstWord },
  });
  return created.id;
};

const createVehicleListing = async ({
  userId,
  vehicleId,
  vehicleNumber,
  brandId,
  cityId,
  vehicleName,
  model,
  description,
  vehicleYear,
  vehicleType,
  vehicleCc,
  vehicleFuelType,
  vehicleTransmission,
  vehicleSeats,
  engineNumber,
  chassisNumber,
  rcImageUrl,
  rcBackImageUrl,
  ownerName,
  maker,
  color,
  images,
  pickup,
  preferences,
  vehiclePlan,
}) => {
  const host = await Host.findOne({ where: { userId } });
  if (!host) throw new CustomError('Complete host onboarding before adding a car', 400);

  const number = normalizeVehicleNumber(vehicleNumber);
  const plan = vehiclePlan || {};
  // Accept both the documented names and the ones the clients send.
  const weekdayFee = plan.weekdayFee ?? plan.weekdayPricing;
  const weekendFee = plan.weekendFee ?? plan.weekendPricing;
  const extraKmFee = plan.extraKmFee ?? plan.perHourFee;

  // Validate everything up front — a listing is all-or-nothing now, so a
  // missing field should fail before any write rather than half way through.
  if (!number) throw new CustomError('Vehicle number is required', 400);
  // brandId is resolved from the RC manufacturer below, not chosen by the host.
  if (!vehicleName) throw new CustomError('Vehicle name is required', 400);
  if (!Array.isArray(images) || images.length === 0) {
    throw new CustomError('At least one photo is required', 400);
  }
  if (!pickup || pickup.lat == null || pickup.long == null) {
    throw new CustomError('Pickup location is required', 400);
  }
  if (!plan.kmAlloted || weekdayFee == null || weekendFee == null) {
    throw new CustomError('Alloted kms and weekday/weekend pricing are required', 400);
  }

  // These columns are NOT NULL and used by the search filters. The RC lookup
  // supplied them before; with verification bypassed the host provides them,
  // and RC values (below) still win when verification is enabled.
  const specs = {
    vehicleYear: vehicleYear == null || vehicleYear === '' ? null : parseInt(vehicleYear, 10),
    vehicleType: vehicleType ? String(vehicleType).toLowerCase() : null,
    vehicleCc: vehicleCc == null || vehicleCc === '' ? null : parseInt(vehicleCc, 10),
    vehicleFuelType: vehicleFuelType ? String(vehicleFuelType).toLowerCase() : null,
    vehicleTransmission: String(vehicleTransmission || 'manual').toLowerCase(),
    vehicleSeats: vehicleSeats == null || vehicleSeats === '' ? 4 : parseInt(vehicleSeats, 10),
  };
  const missingSpec = ['vehicleYear', 'vehicleType', 'vehicleCc', 'vehicleFuelType'].find(
    (key) => specs[key] == null || Number.isNaN(specs[key])
  );
  if (missingSpec) {
    const labels = {
      vehicleYear: 'Manufacturing year',
      vehicleType: 'Vehicle type',
      vehicleCc: 'Engine capacity (cc)',
      vehicleFuelType: 'Fuel type',
    };
    throw new CustomError(`${labels[missingSpec]} is required`, 400);
  }
  if (!['manual', 'automatic'].includes(specs.vehicleTransmission)) {
    throw new CustomError('Transmission must be manual or automatic', 400);
  }

  const duplicateWhere = {
    vehicleNumber: Sequelize.where(
      Sequelize.fn('LOWER', Sequelize.col('vehicleNumber')),
      number.toLowerCase()
    ),
    deleted: false,
  };
  // Finishing an existing draft shouldn't collide with itself.
  if (vehicleId) duplicateWhere.id = { [Op.ne]: vehicleId };
  if (await Vehicle.findOne({ where: duplicateWhere })) {
    throw new CustomError('Vehicle with this registration number already exists', 400);
  }

  // The RC is already verified earlier in the wizard (the verify/scan step), so
  // the listing is NOT re-verified on publish. The vehicle is built from the
  // details the client collected there; no RC provider call happens here.
  const verificationId = generateVerificationId();
  const rc = null;
  const rcFields = {};

  const resolvedBrandId = await resolveBrandId(maker, brandId);
  if (!resolvedBrandId) throw new CustomError('Could not determine the vehicle brand from the RC.', 400);

  const transaction = await db.transaction();
  try {
    let vehicle;
    const attributes = {
      vehicleBrand: resolvedBrandId,
      vehicleName,
      model,
      description,
      // Straight from the RC record.
      ownerName: ownerName || null,
      vehicleMaker: maker || null,
      vehicleColor: color || null,
      ...specs,
      ...rcFields,
      vehicleNumber: rc?.vehicle_number || number,
      // Never host-typed — these come straight from the RC OCR/lookup.
      vehicleEngineNumber: rc?.vehicle_engine_number || engineNumber || null,
      vehicleChassisNumber: rc?.vehicle_chasi_number || chassisNumber || null,
      isDraft: false,
    };

    if (vehicleId) {
      vehicle = await Vehicle.findOne({
        where: { id: vehicleId, hostId: host.id, deleted: false },
        transaction,
      });
      if (!vehicle) throw new CustomError('Vehicle not found', 404);
      await vehicle.update(attributes, { transaction });
    } else {
      let randomVehicleId;
      do {
        randomVehicleId = Math.floor(10000 + Math.random() * 90000);
      } while (await Vehicle.findOne({ where: { vehicleId: randomVehicleId }, transaction }));

      vehicle = await Vehicle.create(
        { ...attributes, vehicleId: randomVehicleId, ownerType: 1, hostId: host.id },
        { transaction }
      );
    }

    // Record the RC as a document row. This is the source of truth the admin
    // RC screen reads; the inline vehicle columns are legacy and going away.
    // Written outside the vehicle attributes so the RC-derived details stay
    // attached to the document that produced them.
    await VehicleRcDocument.update(
      { isCurrent: false },
      { where: { vehicleId: vehicle.id, isCurrent: true }, transaction },
    );
    await VehicleRcDocument.create({
      vehicleId: vehicle.id,
      rcNumber: rc?.vehicle_number || number || null,
      imageKey: rcImageUrl || null,
      backImageKey: rcBackImageUrl || null,
      ownerName: rc?.owner_name || null,
      makerModel: rc?.maker_model || null,
      makerDescription: rc?.maker_description || maker || null,
      manufacturedYear: rc?.manufacturing_date_formatted || null,
      colour: rc?.color || color || null,
      fuelType: rc?.fuel_type || null,
      engineNumber: rc?.vehicle_engine_number || engineNumber || null,
      chassisNumber: rc?.vehicle_chasi_number || chassisNumber || null,
      // The provider verified the RC; whether the LISTING is approved is a
      // separate admin decision, so the document starts pending.
      status: 'pending',
      providerStatus: rc ? 'VERIFIED' : null,
      verificationId: verificationId || null,
      providerCheckedAt: rc ? new Date() : null,
      isCurrent: true,
    }, { transaction });

    // Replace rather than append — the host may have revisited any step before
    // publishing, and a re-published draft shouldn't keep the stale rows.
    await Image.destroy({ where: { vehicleId: vehicle.id }, transaction });
    await Image.bulkCreate(
      images.map((image) => ({ ...image, vehicleId: vehicle.id })),
      { transaction }
    );

    await Pickup.destroy({ where: { vehicleId: vehicle.id }, transaction });
    const pickupPoint = await Pickup.create(
      {
        vehicleId: vehicle.id,
        cityId: pickup.cityId || cityId,
        address: pickup.address,
        lat: pickup.lat,
        long: pickup.long,
        hostId: host.id,
      },
      { transaction }
    );
    vehicle.pickupId = pickupPoint.id;
    await vehicle.save({ transaction });

    await VehiclePreference.destroy({ where: { vehicleId: vehicle.id }, transaction });
    await VehiclePreference.create(
      {
        vehicleId: vehicle.id,
        hostId: host.id,
        midnightBooking: !!preferences?.midnightBooking,
        selfPickup: !!preferences?.selfPickup,
        deliverAvailable: !!preferences?.deliverAvailable,
      },
      { transaction }
    );

    await VehiclePlan.destroy({ where: { vehicleId: vehicle.id }, transaction });
    await VehiclePlan.create(
      {
        vehicleId: vehicle.id,
        hostId: host.id,
        kmAlloted: plan.kmAlloted,
        // extraKmFee is NOT NULL with no DB default — coerce to a number so a
        // missing/blank value can't abort the whole publish transaction.
        extraKmFee: Number(extraKmFee) || 0,
        weekdayFee: Number(weekdayFee) || 0,
        weekendFee: Number(weekendFee) || 0,
        startTime: plan.startTime || new Date(),
        endTime: plan.endTime || null,
      },
      { transaction }
    );

    await transaction.commit();
    return vehicle;
  } catch (error) {
    // Only roll back if the transaction is still open — otherwise Sequelize
    // throws "cannot be rolled back … state: rollback" and hides the real error.
    if (!transaction.finished) await transaction.rollback();
    console.log('createVehicleListing failed:', error);
    throw error instanceof CustomError ? error : new CustomError(error.message, 400);
  }
};

const normalizeVehicleNumber = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();

// RC records use their own vocabulary ("SALOON", "MOTOR CAR"); the search
// filters use ours. Map onto ours so a fetched car is actually findable.
const mapBodyType = (value) => {
  const raw = String(value || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('hatch')) return 'hatchback';
  if (raw.includes('saloon') || raw.includes('sedan')) return 'sedan';
  if (raw.includes('compact')) return 'compact-suv';
  if (raw.includes('suv') || raw.includes('utility') || raw.includes('wagon')) return 'suv';
  if (raw.includes('motor car') || raw.includes('car')) return 'sedan';
  return null;
};

const mapFuelType = (value) => {
  const raw = String(value || '').toLowerCase();
  if (!raw) return null;
  if (raw.includes('petrol')) return 'petrol';
  if (raw.includes('diesel')) return 'diesel';
  if (raw.includes('electric') || raw.includes('ev')) return 'electric';
  if (raw.includes('cng') || raw.includes('lpg')) return 'petrol';
  return null;
};

const mapTransmission = (value) =>
  String(value || '').toLowerCase().includes('auto') ? 'automatic' : 'manual';

// COCARR only lists cars. RC records describe the vehicle class in a few
// different fields depending on the source (OCR vs the RC lookup), so scan them
// all for anything that clearly isn't a passenger car.
const NON_CAR_PATTERNS = [
  'motor cycle', 'motorcycle', 'm-cycle', 'm.cycle', 'mcycle', 'scooter', 'moped',
  'two wheeler', '2 wheeler', '2wn', '2wt', '2wic', 'bike',
  'three wheeler', '3 wheeler', '3wn', '3wt', 'auto rickshaw', 'rickshaw', 'e-rickshaw',
  'goods', 'truck', 'lorry', 'tractor', 'trailer', 'tanker', 'dumper',
  'bus', 'omni bus', 'maxi cab', 'ambulance', 'crane', 'harvester', 'road roller',
];
const isNonCarRc = (...values) => {
  const text = values.filter(Boolean).map((v) => String(v).toLowerCase()).join(' | ');
  if (!text) return false;
  return NON_CAR_PATTERNS.some((p) => text.includes(p));
};
const assertIsCar = (...values) => {
  if (isNonCarRc(...values)) {
    throw new CustomError('Only cars can be listed on COCARR — this registration is not a car.', 400);
  }
};

// Cashfree RC lookup used by the host "Verify" step, before the car is created.
// Returns the owner + vehicle details so the app can show them and confirm they
// match the registration number the host typed.
//
// Placeholder values left in the env would otherwise be treated as a real
// provider — kyc.example.com is what produced ENOTFOUND on every listing.
const isPlaceholderUrl = (url) => !url || /example\.(com|org|net)|localhost|changeme|your-/i.test(url);

// KYC endpoints are configured as a base + per-verification path so the same
// credentials serve OCR and RC lookup:
//   KYC_BASE               e.g. https://sandbox.cashfree.com
//   KYC_RC_OCR             e.g. /verification/bharat-ocr
//   KYC_RC_VERIFICATION    e.g. /verification/vehicle-rc
// KYC_URL is the older single-value var; kept as a fallback base so the aadhaar
// and bank-account calls elsewhere keep working.
const kycBase = () => String(process.env.KYC_BASE || process.env.KYC_URL || '').replace(/\/+$/, '');
const kycUrl = (path) => `${kycBase()}${path.startsWith('/') ? path : `/${path}`}`;
const rcOcrUrl = () => kycUrl(process.env.KYC_RC_OCR || '/verification/bharat-ocr');
const rcVerifyUrl = () => kycUrl(process.env.KYC_RC_VERIFICATION || '/verification/vehicle-rc');
// Cashfree requires an API version header (YYYY-MM-DD). Overridable via env.
const KYC_API_VERSION = process.env.KYC_API_VERSION || '2024-12-01';

// The x-cf-signature is produced by utils/signature.js (OAEP padding, matching
// Cashfree's PHP sample) and read from the committed account public key.

// Headers for every Cashfree KYC call (vehicle-rc, bharat-ocr, aadhaar, bank).
//
// This is Cashfree's Two-Factor Authentication (2FA) mode: the signature is a
// SECOND factor sent alongside the client secret, not a replacement for it —
// sending the signature alone returns `x-client-secret_missing`. With 2FA
// enabled on the account, requests are authenticated cryptographically and IP
// whitelisting is not required, which is what makes a rotating egress IP
// survivable. Requires 2FA switched on in the Cashfree dashboard plus the
// account public key (see loadCashfreePublicKey).
const kycHeaders = () => {
  const headers = {
    'x-client-id': `${process.env.KYC_ID}`,
    'x-client-secret': `${process.env.KYC_SECRET}`,
    'x-api-version': KYC_API_VERSION,
  };
  const signature = getSignature();
  if (signature) headers['x-cf-signature'] = signature;
  return headers;
};

// Turns a Cashfree failure into something actionable. Auth/IP problems are a
// server misconfiguration (not the host's fault) and must not read as "your
// registration number is wrong".
const rcProviderError = (error, fallback, context = {}) => {
  const data = error?.response?.data || {};
  if (Object.keys(context).length) console.error('[KYC] request context:', context);
  const code = data.code || '';
  const type = data.type || '';

  if (code === 'ip_validation_failed' || type === 'authentication_error') {
    console.error(
      '[KYC CONFIG] Cashfree rejected this request:', data.message || code,
      '\n  → Whitelist this server\'s outbound IP in the Cashfree dashboard.',
      '\n  → It will keep changing until the service has a STATIC egress IP',
      '\n    (Railway static IP, or route KYC calls through a fixed-IP proxy).'
    );
    return new CustomError('Vehicle verification is temporarily unavailable. Please try again shortly.', 503);
  }

  console.error('RC provider error:', data || error.message);
  // Surface Cashfree's own message when it is meaningful to the host.
  return new CustomError(data.message ? `${fallback} (${data.message})` : fallback, 400);
};

// Whether the KYC provider is wired up (base + credentials, not a placeholder).
// There is no enable/bypass flag: RC verification always runs when configured.
// If it isn't configured, verification errors rather than silently passing.
const isRcConfigured = () =>
  !isPlaceholderUrl(kycBase()) && !!(process.env.KYC_ID && process.env.KYC_SECRET);
const assertRcConfigured = () => {
  if (!isRcConfigured()) {
    throw new CustomError('Vehicle verification is temporarily unavailable. Please try again later.', 503);
  }
};

const verifyVehicleNumber = async ({ vehicleNumber }) => {
  const number = normalizeVehicleNumber(vehicleNumber);
  if (!number) throw new CustomError('Vehicle number is required', 400);

  // Don't spend a verification call on a car that is already listed.
  const existing = await Vehicle.findOne({
    where: {
      vehicleNumber: Sequelize.where(
        Sequelize.fn('LOWER', Sequelize.col('vehicleNumber')),
        number.toLowerCase()
      ),
      deleted: false,
    },
  });
  if (existing) {
    throw new CustomError('Vehicle with this registration number already exists', 400);
  }

  // Verification always runs against the RC records — no bypass. If KYC isn't
  // configured this errors instead of letting an unverified car through.
  assertRcConfigured();

  const verificationId = generateVerificationId();
  let data;
  try {
    const res = await kycHttp.post(
      rcVerifyUrl(),
      { verification_id: verificationId, vehicle_number: number },
      { headers: kycHeaders() }
    );
    data = res.data;
  } catch (error) {
    throw rcProviderError(
      error,
      'Could not verify this registration number. Please check it and try again.',
      { endpoint: rcVerifyUrl(), vehicle_number: number, verification_id: verificationId }
    );
  }

  // Throws when the RC is invalid/inactive, the car is >10 years old or the
  // insurance has expired.
  await verifyVehicleRc(data);

  const returned = normalizeVehicleNumber(data.vehicle_number);
  if (returned && returned !== number) {
    throw new CustomError('RC details do not match the registration number entered', 400);
  }

  return { ...normalizeRcVerifyData(data, number), verificationId };
};

// Shapes the /verification/vehicle-rc response into the payload the onboarding
// wizard consumes: identity fields plus specs already mapped to our vocabulary.
// Cashfree's RC payload uses different key names across API versions/products
// (registration_number vs vehicle_number, colour vs color, seat_capacity vs
// vehicle_seat_capacity, ...). Mapping a single guessed name silently yields
// null for everything, which is why the details UI came back blank — so accept
// every known alias instead.
const pick = (data, ...names) => {
  for (const n of names) {
    const v = data?.[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
};

// Year out of "MM/YYYY", "YYYY-MM", "YYYY" or a full date.
const parseRcYear = (value) => {
  if (!value) return null;
  const m = String(value).match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
};

const normalizeRcVerifyData = (data, fallbackNumber) => {
  // Key names confirmed against a live Cashfree vehicle-rc response; aliases
  // kept so a naming change across API versions doesn't blank the form again.
  console.log('[KYC] RC response keys:', Object.keys(data || {}).join(', '));

  const returned =
    normalizeVehicleNumber(pick(data, 'reg_no', 'vehicle_number', 'registration_number', 'rc_number'))
    || fallbackNumber;

  const manufactured = pick(data, 'vehicle_manufacturing_month_year', 'manufacturing_date', 'manufacture_date');
  const seats = pick(data, 'vehicle_seat_capacity', 'seat_capacity', 'seating_capacity', 'seats');
  const cc = pick(data, 'vehicle_cubic_capacity', 'cubic_capacity', 'engine_cc', 'cc');
  const bodyType = pick(data, 'body_type', 'class', 'vehicle_class_description', 'vehicle_class');
  // The RC carries no transmission field, so it is left null for the host to
  // pick — defaulting it to "manual" would wrongly lock the field.
  const transmission = pick(data, 'transmission', 'transmission_type', 'vehicleTransmission');

  return {
    verified: true,
    bypassed: false,
    manualEntry: false,
    source: 'rc-verify',
    vehicleNumber: returned,
    ownerName: pick(data, 'owner', 'owner_name', 'ownerName'),
    maker: pick(data, 'vehicle_manufacturer_name', 'maker_description', 'manufacturer_name', 'maker'),
    model: pick(data, 'model', 'maker_model', 'vehicle_model'),
    color: pick(data, 'vehicle_colour', 'colour', 'vehicle_color', 'color'),
    registrationDate: pick(data, 'reg_date', 'registration_date', 'regn_dt'),
    manufacturingYear: parseRcYear(manufactured) ? String(parseRcYear(manufactured)) : null,
    bodyType,
    rcStatus: pick(data, 'rc_status', 'rcStatus'),
    insuranceUpto: pick(data, 'vehicle_insurance_upto', 'insurance_upto', 'insurance_valid_upto'),
    // Identity fields — held for dispute/theft checks, shown masked to the host.
    engineNumber: pick(data, 'engine', 'vehicle_engine_number', 'engine_number', 'engine_no'),
    chassisNumber: pick(data, 'chassis', 'vehicle_chasi_number', 'chassis_number', 'chasi_number'),
    // Pre-mapped onto the values the wizard and the search filters use.
    specs: {
      vehicleYear: parseRcYear(manufactured),
      vehicleType: mapBodyType(bodyType),
      vehicleCc: cc ? parseInt(cc, 10) : null,
      vehicleFuelType: mapFuelType(pick(data, 'type', 'fuel_type', 'fuel')),
      vehicleTransmission: transmission ? mapTransmission(transmission) : null,
      vehicleSeats: seats ? parseInt(seats, 10) : null,
    },
  };
};

// Vehicle onboarding — step 1. Runs the RC card image through bharat-ocr, reads
// the registration number, then fetches the authoritative RC record. If the RC
// lookup fails, the OCR data itself is used to populate step 2. The RC image is
// stored so it can be attached to the vehicle on publish.
const onboardVehicleFromRc = async ({ userId, fileBuffer, mimeType }) => {
  if (!fileBuffer || !fileBuffer.length) {
    throw new CustomError('RC image is required', 400);
  }
  // No bypass — scanning requires a configured provider.
  assertRcConfigured();

  const FormData = require('form-data');
  const form = new FormData();
  const ocrVerificationId = generateVerificationId();
  form.append('document_type', 'VEHICLE_RC');
  form.append('verification_id', ocrVerificationId);
  form.append('file', fileBuffer, {
    filename: `rc-${Date.now()}.jpg`,
    contentType: mimeType || 'image/jpeg',
  });

  let ocr;
  try {
    const res = await kycHttp.post(rcOcrUrl(), form, {
      headers: { ...kycHeaders(), ...form.getHeaders() },
      maxBodyLength: Infinity,
    });
    ocr = res.data;
  } catch (error) {
    throw rcProviderError(
      error,
      "Couldn't read that RC image. Make sure the whole card is visible and try again.",
      { endpoint: rcOcrUrl(), verification_id: ocrVerificationId }
    );
  }

  if (ocr?.status && ocr.status !== 'VALID') {
    throw new CustomError(
      "That doesn't look like a valid RC document. Please upload a clear photo of the RC card.",
      400
    );
  }
  const fields = ocr?.document_fields || {};
  const ocrNumber = normalizeVehicleNumber(fields.registration_number);
  if (!ocrNumber) {
    throw new CustomError("Couldn't read the registration number from that image.", 400);
  }
  // Reject non-cars up front, using whatever class the OCR read off the card.
  assertIsCar(fields.vehicle_type, fields.vehicle_class, fields.vehicle_category);

  // Block a duplicate before spending the RC lookup.
  const existing = await Vehicle.findOne({
    where: {
      vehicleNumber: Sequelize.where(
        Sequelize.fn('LOWER', Sequelize.col('vehicleNumber')),
        ocrNumber.toLowerCase()
      ),
      deleted: false,
    },
  });
  if (existing) {
    throw new CustomError('Vehicle with this registration number already exists', 400);
  }

  // Persist the RC image (best-effort) so it can be saved with the vehicle.
  let rcImageUrl = null;
  try {
    rcImageUrl = await imageService.putObject(fileBuffer, mimeType || 'image/jpeg', 'vehicle-rc');
  } catch (error) {
    console.error('Failed to store RC image:', error.message);
  }

  // Fetch and validate the authoritative RC record. No bypass — if the lookup
  // fails or the RC doesn't pass the checks, onboarding stops here.
  const verificationId = generateVerificationId();
  let data;
  try {
    const res = await kycHttp.post(
      rcVerifyUrl(),
      { verification_id: verificationId, vehicle_number: ocrNumber },
      { headers: kycHeaders() }
    );
    data = res.data;
  } catch (error) {
    throw rcProviderError(
      error,
      'Could not verify the RC for this vehicle. Please try again.',
      { endpoint: rcVerifyUrl(), vehicle_number: ocrNumber, verification_id: verificationId }
    );
  }
  await verifyVehicleRc(data); // throws on invalid/inactive/too-old/expired/non-car

  const payload = { ...normalizeRcVerifyData(data, ocrNumber), verificationId };
  return { ...payload, rcImageUrl, ocrRaw: fields };
};

const verifyVehicleRc = async (data) => {
  if(data.status !== 'VALID') throw new CustomError('Vehicle RC is Invalid', 400);
  if(data.rc_status !=='ACTIVE') throw new CustomError('Vehicle RC is not Active', 400);
  // Reject bikes, autos, goods carriers etc. — only cars are allowed.
  assertIsCar(data.body_type, data.vehicle_category, data.vehicle_class_description, data.vehicle_class, data.maker_model);
  if(data.vehicle_manufacturing_month_year) {
    const [month, year] = data.vehicle_manufacturing_month_year.split('/');
    const manufacturingDate = new Date(parseInt(year), parseInt(month) - 1);
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    
    if(manufacturingDate < tenYearsAgo) {
      throw new CustomError('Vehicle cannot be more than 10 years old', 400);
    }
  }
  if(data.vehicle_insurance_upto) {
    const insuranceDate = new Date(data.vehicle_insurance_upto);
    const currentDate = new Date();
    if(insuranceDate < currentDate) {
      throw new CustomError('Vehicle insurance has expired', 400);
    }
  }
}

const updateVehicle = async ({ type, vehicleId, userId, data }) => {
  const transaction = await db.transaction();
  try {
    const host = await Host.findOne({ where: { userId: userId } });
    if (!host) {
      throw new CustomError('Host not found', 404);
    }

    let vehicle = await Vehicle.findByPk(vehicleId);
    if (!vehicle) {
      throw new CustomError('Vehicle not found', 404);
    }

    switch (data.type) {
      case 'info':
        await vehicle.update(data, { transaction });
        break;
      case 'pickup': {
        // Edit the vehicle's pickup point (address, and optionally city/coords).
        if (!data.pickup) throw new CustomError('Pickup data is required', 400);
        const pickupUpdate = {};
        for (const k of ['address', 'cityId', 'lat', 'long']) {
          if (data.pickup[k] !== undefined) pickupUpdate[k] = data.pickup[k];
        }
        if (Object.keys(pickupUpdate).length === 0) throw new CustomError('Nothing to update', 400);
        const [rows] = await Pickup.update(pickupUpdate, { where: { vehicleId }, transaction });
        if (rows === 0) throw new CustomError('Pickup point not found for this vehicle', 404);
        break;
      }
      case 'images':
        if (data.images && data.images.length > 0) {
          await Image.destroy({ where: { vehicleId: vehicleId }, transaction });
          const allImages = data.images.map(image => ({ ...image, vehicleId }));
          await Image.bulkCreate(allImages, { transaction });
        } else {
          throw new CustomError('Images data is required', 400);
        }
        break;
      case 'preference':
        const updateResult = await VehiclePreference.update(data.preferences, { where: { vehicleId: vehicleId, hostId: host.id }, transaction, returning: true });
        if (updateResult[1] === 0) {
          await VehiclePreference.create({ vehicleId: vehicleId, hostId: host.id, ...data.preferences }, { transaction });
        }
        break;
      case 'pricingPlan':
        const currentDateTime = new Date();
        await VehiclePlan.update({ endTime: currentDateTime }, { where: { vehicleId: vehicleId, endTime: null }, transaction });
        await VehiclePlan.create({
          vehicleId,
          hostId: host.id,
          kmAlloted:data.vehiclePlan.kmAlloted,
          extraKmFee:data.vehiclePlan.extraKmFee,
          weekdayFee:data.vehiclePlan.weekdayFee,
          perHourFee:data.vehiclePlan.weekdayFee,
          weekendFee:data.vehiclePlan.weekendFee,
          startTime: currentDateTime
        }, { transaction });
        break;
      default:
        throw new CustomError('Invalid update type', 400);
    }

    // Editing a rejected vehicle IS the resubmission — it goes back into the
    // review queue and the old reason is cleared, so the host isn't left
    // staring at feedback they have already addressed.
    if (vehicle.approvalStatus === 'rejected') {
      await vehicle.update({
        approvalStatus: 'pending',
        rejectionReason: null,
        isAdminApproved: false,
      }, { transaction });
    }

    await transaction.commit();
    return vehicle;
  } catch (error) {
    await transaction.rollback();
    console.log(error)
    throw new CustomError(error.message, 400);
  }
};

const getMyVehicles = async (hostId) => {
  try {
    const host = await Host.findOne({ where: { userId: hostId } });
    const totalVehicles = await Vehicle.count({ where: { hostId: host.id } });

    let vehicles = await Vehicle.findAll({
      where: { hostId: host.id },
      include: [
        {
          model: Image,
          as: 'images',
        },
        {
          model: Brand,
          as: 'brand',
        },
        {
          model: Pickup,
          as: 'pickupPoint',
          include: [{ model: City, as: 'city' }],
        },
        {
          model: VehiclePreference,
          as: 'vehiclePreference',
        },
        {
          model: VehiclePlan,
          as: 'vehiclePlan',
          order: [['startTime', 'DESC']],
          limit: 1,
          where: {
            startTime: { [Op.lte]: new Date() },
          },
        },
      ],
    });

    return { vehicles, count: totalVehicles };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const getMyVehicleById = async ({ userId, vehicleId }) => {
  try {
    const host = await Host.findOne({ where: { userId: userId } });

    let vehicle = await Vehicle.findOne({
      where: { hostId: host.id, id: vehicleId },
      include: [
        {
          model: Image,
          as: 'images',
        },
        {
          model: Brand,
          as: 'brand',
        },
        {
          model: Pickup,
          as: 'pickupPoint',
          include: [{ model: City, as: 'city' }],
        },
        {
          model: VehiclePreference,
          as: 'vehiclePreference',
        },
        {
          model: VehiclePlan,
          as: 'vehiclePlan',
          order: [['startTime', 'DESC']],
          limit: 1,
          where: {
            startTime: { [Op.lte]: new Date() },
          },
        },
      ],
    });

    if (!vehicle) {
      throw new CustomError('Vehicle not found', 404);
    }

    const isDraft = vehicle.isDraft;
    let isImagesUploaded = false;
    let isPickupAdded = false;
    let isPreferencesAdded = false;
    let isPricingPlanAdded = false;

    if (isDraft) {
      isImagesUploaded = vehicle.images && vehicle.images.length > 0;
      isPickupAdded = !!vehicle.pickupPoint;
      
      // Assuming there's a Preferences model to check preferences
      const preferences = await VehiclePreference.findOne({ where: { vehicleId: vehicle.id, hostId: host.id } });
      isPreferencesAdded = !!preferences;

      isPricingPlanAdded = vehicle.vehiclePlan && vehicle.vehiclePlan.length > 0;
    }

    return {
      ...vehicle.toJSON(),
      isImagesUploaded,
      isPickupAdded,
      isPreferencesAdded,
      isPricingPlanAdded,
    };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const getSchedules = async ({userId, vehicleId, sort='-createdAt', offset=0, limit=10, status}) => {
  try {
    let host = await Host.findOne({ where: { userId: userId } });
    let whereClause = {deleted:false};
    let orderClause = [];

    if (vehicleId) {
      whereClause.vehicleId = vehicleId;
    } else {
      const vehicles = await Vehicle.findAll({ where: { hostId: host.id } });
      const vehicleIds = vehicles.map(vehicle => vehicle.id);
      whereClause.vehicleId = { [Op.in]: vehicleIds };
    }

    if(sort){
      const sortColumn = sort.startsWith('-') ? sort.substring(1) : sort;
      const sortOrder = sort.startsWith('-') ? 'DESC' : 'ASC';
      orderClause.push([sortColumn, sortOrder]);
    }

    if (status) {
      whereClause.status = status;
    }

    let totalSchedules = await Schedule.count({ where: whereClause });
    let schedules = await Schedule.findAll({
      where: whereClause,
      include: [{ model: ScheduleBlock, as: 'scheduleBlocks' ,where:{deleted:false},required:false},{model:Vehicle,as:'vehicle',include:[{model:Image,as:'images'}]}],
      order: orderClause,
      limit: isNaN(limit) ? 10 : parseInt(limit),
      offset: isNaN(offset) ? 0 : parseInt(offset)
    });

    return { schedules, count: totalSchedules };
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const getScheduleById = async (id) => {
  try {
    let schedule = await Schedule.findByPk(id, {
      include: [
        {
          model: ScheduleBlock,
          as: 'scheduleBlocks',
          where: { deleted: false },
          required: false
        },
        {
          model: Vehicle,
          as: 'vehicle',
          include: [{ model: Image, as: 'images' }]
        }
      ]
    });
    if(!schedule) throw new CustomError('Schedule not found', 404);
    return schedule;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const createScheduleBlock = async (scheduleBlockData) => {
  try {
    const { scheduleId, startTime, endTime } = scheduleBlockData;

    // Check if the startTime and endTime are within the schedule's time range
    const schedule = await Schedule.findByPk(scheduleId);
    if (!schedule) {
      throw new CustomError('Schedule not found', 404);
    }

    if (new Date(startTime) < new Date(schedule.startTime) || new Date(endTime) > new Date(schedule.endTime)) {
      throw new CustomError('The schedule block time range must be within the schedule time range', 400);
    }

    // Check if there is any existing schedule block that conflicts with this
    const conflictingScheduleBlock = await ScheduleBlock.findOne({
      where: {
        scheduleId: scheduleId,
        [Op.or]: [
          {
            startTime: {
              [Op.between]: [startTime, endTime]
            }
          },
          {
            endTime: {
              [Op.between]: [startTime, endTime]
            }
          },
          {
            [Op.and]: [
              {
                startTime: {
                  [Op.lte]: startTime
                }
              },
              {
                endTime: {
                  [Op.gte]: endTime
                }
              }
            ]
          }
        ]
      }
    });

    if (conflictingScheduleBlock) {
      throw new CustomError('Schedule block already exists for the provided time range', 400);
    }

    return await ScheduleBlock.create({...scheduleBlockData,vehicleId:schedule.vehicleId});
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const createSchedule = async (scheduleData) => {
  try {
    const { vehicleId, userId:hostId, startTime, endTime } = scheduleData;

    // Check if startTime and endTime are valid and have a minimum of 12 hours gap
    const start = new Date(startTime);
    const end = new Date(endTime);
    const timeDiff = (end - start) / (1000 * 60 * 60); // difference in hours

    if (timeDiff < 12) {
      throw new CustomError('The schedule must have a minimum of 12 hours gap between startTime and endTime', 400);
    }
    const host = await Host.findOne({ where: { userId: hostId } });
    // Check if the vehicle exists with provided hostId and vehicleId
    const vehicle = await Vehicle.findOne({ where: { id: vehicleId, hostId: host.id } });
    if (!vehicle) {
      throw new CustomError('Vehicle not found for the provided hostId and vehicleId', 404);
    }

    // Check if there is any existing schedule that conflicts with this
    const conflictingSchedules = await Schedule.findOne({
      where: {
        vehicleId: vehicleId,
        deleted:false,
        [Op.or]: [
          {
            startTime: {
              [Op.between]: [startTime, endTime]
            }
          },
          {
            endTime: {
              [Op.between]: [startTime, endTime]
            }
          },
          {
            [Op.and]: [
              {
                startTime: {
                  [Op.lte]: startTime
                }
              },
              {
                endTime: {
                  [Op.gte]: endTime
                }
              }
            ]
          }
        ]
      }
    });

    if (conflictingSchedules) {
      throw new CustomError('Schedule already exists for the provided time range', 400);
    }

    return await Schedule.create(scheduleData);
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const deleteScheduleBlock = async (id) => {
  try {
    await ScheduleBlock.update({deleted:true},{where:{id}});
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};


const deleteSchedule = async (id) => {
  try {
    await Schedule.update({deleted: true}, {where: {id}});
    await ScheduleBlock.update({deleted: true}, {where: {scheduleId: id}});
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const getHostCommissions = async (hostId) => {
  try {
    const host = await Host.findOne({ where: { userId: hostId } });
    if (!host) throw new CustomError('Host not found', 404);

    const commissions = await HostCommission.findAll({
      where: { hostId: host.id },
      order: [['startDate', 'DESC']]
    });

    return commissions;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const getActiveHostCommission = async (hostId) => {
  try {
    const host = await Host.findOne({ where: { userId: hostId } });
    if (!host) throw new CustomError('Host not found', 404);

    const activeCommission = await HostCommission.findOne({
      where: { hostId: host.id, isActive: true },
      order: [['startDate', 'DESC']]
    });

    return activeCommission;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const addHostCommission = async (hostId, commissionData) => {
  const transaction = await db.transaction();
  try {
    const host = await Host.findOne({ where: { userId: hostId } });
    if (!host) throw new CustomError('Host not found', 404);

    if (!commissionData.commissionPercentage || !commissionData.startDate) {
      throw new CustomError('Commission percentage and start date are required', 400);
    }

    // Validate commission percentage
    if (commissionData.commissionPercentage < 0 || commissionData.commissionPercentage > 100) {
      throw new CustomError('Commission percentage must be between 0 and 100', 400);
    }

    // Check if there's an existing active commission
    const existingActiveCommission = await HostCommission.findOne({
      where: { hostId: host.id, isActive: true },
      transaction
    });

    // Deactivate the existing active commission
    if (existingActiveCommission) {
      existingActiveCommission.endDate = new Date(commissionData.startDate);
      existingActiveCommission.isActive = false;
      await existingActiveCommission.save({ transaction });
    }

    // Create new commission
    const newCommission = await HostCommission.create({
      hostId: host.id,
      commissionPercentage: commissionData.commissionPercentage,
      startDate: new Date(commissionData.startDate),
      endDate: commissionData.endDate ? new Date(commissionData.endDate) : null,
      isActive: true
    }, { transaction });

    await transaction.commit();
    return newCommission;
  } catch (error) {
    await transaction.rollback();
    throw new CustomError(error.message, 400);
  }
};

const updateHostCommission = async (commissionId, commissionData, hostId) => {
  try {
    const host = await Host.findOne({ where: { userId: hostId } });
    if (!host) throw new CustomError('Host not found', 404);

    const commission = await HostCommission.findOne({
      where: { id: commissionId, hostId: host.id }
    });

    if (!commission) throw new CustomError('Commission not found', 404);

    // If we're updating to isActive = true, deactivate other active commissions
    if (commissionData.isActive === true && !commission.isActive) {
      await HostCommission.update(
        { isActive: false },
        { where: { hostId: host.id, isActive: true } }
      );
    }

    await commission.update(commissionData);
    return commission;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

module.exports = {
  verifyVehicleNumber,
  createHost,
  checkHost,
  getHostById,
  getAllHosts,
  updateHost,
  getHostBookings,
  endBooking,
  startBooking,
  getHostPayoutBankAccount,
  createHostPayoutBankAccount,
  createHostReview,
  cancelBooking,
  getHostBookingById,
  createVehicle,
  createVehicleListing,
  onboardVehicleFromRc,
  updateVehicle,
  getMyVehicles,
  getMyVehicleById,
  getSchedules,
  getScheduleById,
  createSchedule,
  deleteSchedule,
  deleteScheduleBlock,
  createScheduleBlock,
  getHostCommissions,
  getActiveHostCommission,
  addHostCommission,
  updateHostCommission
};
