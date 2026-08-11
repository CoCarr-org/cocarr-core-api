const { Op, where, Sequelize } = require('sequelize');
const Vehicle = require('../models/vehicle');
const Vendor = require('../models/vendor');
const Image = require('../models/image');
const Brand = require('../models/brand');
const VehiclePlan = require('../models/vehicleplan');
const Transaction = require('../models/transaction');
const db = require('../configs/db');
const Pickup = require('../models/pickuppoint');
const Booking = require('../models/booking');
const { CustomError } = require('../middlewares/error');
const { precheck } = require('./userService');
const { getMembershipInfo } = require('./membershipTypeService');
const { BOOKING_BOOKED, BOOKING_ONGOING } = require('../configs/constants');
const { checkTimeGaps } = require('../helper/utils');
const City = require('../models/city');
const moment = require('moment');
const ScheduleBlock = require('../models/scheduleBlock');
const Schedule = require('../models/schedule');
const Host = require('../models/host');
const VehiclePreference = require('../models/vehiclePreference');

const getAllVehicles = async ({searchTerm,  sortBy='vehicleName', filters, startTime, endTime, userId, status = true, limit = 10, offset=0,geo}) => {
  try {
    // A WINDOW IS REQUIRED, AND MUST BE A NUMBER.
    //
    // startTime/endTime are UNIX seconds and are interpolated into the SQL as
    // formatted datetimes. Absent or non-numeric, `new Date(NaN * 1000)` is an
    // Invalid Date and moment formats it as the literal string 'Invalid date',
    // which reaches MySQL as `Incorrect DATETIME value: 'Invalid date'` — a 400
    // that names neither the parameter nor the caller's mistake.
    //
    // checkTimeGaps does NOT catch this: every comparison it makes on NaN is
    // false, so it returns true for `(undefined, undefined)` and the bad value
    // flows straight through. It answers "is this window long enough", which is
    // a different question from "is this a window at all".
    const startSeconds = Number(startTime);
    const endSeconds = Number(endTime);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
      throw new CustomError(
        'startTime and endTime are required, as UNIX timestamps in seconds.', 400,
      );
    }
    if (endSeconds <= startSeconds) {
      throw new CustomError('endTime must be after startTime.', 400);
    }

    if (!checkTimeGaps(startTime, endTime)) return false;
    console.log('filters', filters);
    console.log('searchTerm', startTime,endTime);
    let vehiclePreferenceWhere = {}

    // Check if startTime is between 11pm and 7am
    const startDateTime = new Date(startTime * 1000);
    const startHour = startDateTime.getHours();
    if (startHour >= 23 || startHour < 7) {
      vehiclePreferenceWhere.midnightBooking = 1;
    }

    const whereClause = searchTerm
      ? {
          deleted: false,
          isAdminApproved: true,
          isDraft: false,
          active: true,
          [Op.or]: [
            { vehicleName: { [Op.like]: `%${searchTerm}%` } },
            { vehicleBrand: { [Op.like]: `%${searchTerm}%` } },
          ],
        }
      : { deleted: false ,active:true,isDraft:false,isAdminApproved:true};

    if (filters) {
      if (filters.type) {
        const types = filters.type.toLowerCase().split(',');
        if (types.includes('luxury')) {
          console.log('types luxury', types);
          whereClause.isLuxury = 1;
          const nonLuxuryTypes = types.filter(type => type !== 'luxury');
          if (nonLuxuryTypes.length > 0) {
            whereClause.vehicleType = { [Op.in]: nonLuxuryTypes };
          }
        } else {
          console.log('types not luxury', types);
          whereClause.vehicleType = { [Op.in]: types };
        }
      }
      if (filters.brand) {
        whereClause.vehicleBrand = { [Op.in]: filters.brand.toLowerCase().split(',') };
      }
      if (filters.fuel) {
        whereClause.vehicleFuelType = { [Op.in]: filters.fuel.toLowerCase().split(',') };
      }
      if (filters.seats) {
        whereClause.vehicleSeats = { [Op.in]: filters.seats.toLowerCase().split(',') };
      }
      if (filters.userRating) {
        whereClause.rating = { [Op.gte]: filters.userRating };
      }
      if (filters.deliveryType) {
        const deliveryTypes = filters.deliveryType.toLowerCase().split(',');
        if (deliveryTypes.includes('homedelivery')) {
          vehiclePreferenceWhere.deliverAvailable = 1;
        }
        if (deliveryTypes.includes('pickup')) {
          vehiclePreferenceWhere.selfPickup = 1;
        }
      }
      if (filters.vehicleTransmissionType) {
        whereClause.vehicleTransmission = { [Op.in]: filters.vehicleTransmissionType.toLowerCase().split(',') };
      }
    }

    console.log('whereClause', whereClause);
    let order = [];
    if (sortBy) {
      const sortOrderSign = sortBy.startsWith('-') ? 'DESC' : 'ASC';
      const sortByField = sortBy.replace('-', '');
      if (sortByField === 'rating') {
        order = [['active', 'DESC'], ['rating', sortOrderSign]];
      } else {
        order = [['active', 'DESC'], ['vehicleName', 'ASC']];
      }
    } else {
      order = [['active', 'DESC'], ['vehicleName', 'ASC']];
    }

    let includeOptions = [
      {
        model: Vendor,
        as: 'owner',
      },
      {
        model: Image,
        as: 'images',
        attributes: ['url', 'isCover'],
      },
      {
        model: Brand,
        as: 'brand',
        attributes: ['name'],
      },
      {
        model: VehiclePlan,
        as: 'vehiclePlan',
        order: [['startTime', 'DESC']],
        limit: 1,
      },
      {
        model: VehiclePreference,
        as: 'vehiclePreference',
        where: vehiclePreferenceWhere,
      },
    ];

    // THE DISTANCE EXPRESSION REFERENCES `pickupPoint`, SO THE JOIN HAS TO BE
    // THERE WHENEVER IT IS BUILT — not only when filtering by city.
    //
    // This join used to be added for `filters.city` alone, while the distance
    // expression below is built from `geo` OR the city. So a lat/lng search with
    // no city produced `Unknown column 'pickupPoint.lat' in 'field list'` — the
    // rider web app's whole location search.
    const hasGeo = !!(geo && geo.lat != null && geo.lng != null
      && !isNaN(geo.lat) && !isNaN(geo.lng));

    if ((filters && filters.city) || hasGeo) {
      includeOptions.push({
        model: Pickup,
        as: 'pickupPoint',
        // `required` MUST be explicit. Adding the include with a `where` (the
        // city path) makes Sequelize default it to required -> INNER JOIN, and
        // that path works. Adding it WITHOUT a where (the geo path) defaults to
        // required:false -> LEFT OUTER JOIN, and production still answered
        // "Unknown column 'pickupPoint.lat' in 'field list'" — the alias is not
        // in scope for the SELECT that Sequelize actually emits for a
        // non-required include alongside `limit` and duplicating hasMany
        // includes.
        //
        // INNER is also the honest semantics: the distance is computed FROM the
        // pickup point, so a vehicle without one has no distance and cannot be
        // a result of a location search. This makes the geo path structurally
        // identical to the city path, which is the one known to work.
        required: true,
        // No city filter when we are only here for the coordinates.
        ...(filters?.city ? { where: { cityId: filters.city } } : {}),
      });
    }

    const endDateTime = new Date(endTime * 1000);

    let distanceQuery = '';
    let havingClause = [];
    
    if (hasGeo) {
      distanceQuery = `(6371 * acos(cos(radians(${geo.lat})) * cos(radians(pickupPoint.lat)) * cos(radians(pickupPoint.long) - radians(${geo.lng})) + sin(radians(${geo.lat})) * sin(radians(pickupPoint.lat))))`;
    } else if (filters?.city) {
      const city = await City.findOne({ where: { id: filters.city } });
      if (city) {
        distanceQuery = `(6371 * acos(cos(radians(${city.lat})) * cos(radians(pickupPoint.lat)) * cos(radians(pickupPoint.long) - radians(${city.lng})) + sin(radians(${city.lat})) * sin(radians(pickupPoint.lat))))`;
      }
    }

    let membershipOffer = 0;
    const membershipInfo = await getMembershipInfo();
    membershipOffer = membershipInfo.membershipRideOffer;

    const discountedFeeQuery = `(SELECT perHourFee FROM vehicleplans AS vp WHERE vp.vehicleId = vehicle.id AND vp.endTime IS NULL ORDER BY vp.startTime DESC LIMIT 1) * (1 - ${membershipOffer} / 100)`;

    const twoHoursBeforeStart = moment(new Date(startTime*1000)).subtract(2, 'hours');
    const twoHoursAfterEnd = moment(new Date(endTime*1000)).add(2, 'hours');

    // Get max distance and price from all data without limit
    // AN EMPTY distanceQuery IS NOT A NO-OP — it is invalid SQL.
    //
    // With neither geo nor a resolvable city there is nothing to measure from,
    // and `distanceQuery` stays ''. Interpolated, that produced `MAX()` and
    // `() AS distance`, so an unfiltered GET /vehicle answered with a raw MySQL
    // syntax error. Distance is simply absent in that case.
    const maxAttributes = [
      [Sequelize.fn('MAX', Sequelize.literal(discountedFeeQuery)), 'maxPrice'],
    ];
    if (distanceQuery) {
      maxAttributes.unshift([Sequelize.fn('MAX', Sequelize.literal(distanceQuery)), 'maxDistance']);
    }

    const maxValues = await Vehicle.findOne({
      where: whereClause,
      include: includeOptions,
      attributes: maxAttributes,
      raw: true
    });

    // Add having clause for distance and price filters
    if (filters?.maxDistance && distanceQuery) {
      havingClause.push(`distance <= ${filters.maxDistance}`);
    }
    if (filters?.minPrice) {
      havingClause.push(`discountedFee >= ${filters.minPrice}`);
    }
    if (filters?.maxPrice) {
      havingClause.push(`discountedFee <= ${filters.maxPrice}`);
    }
  
    let vehicles = await Vehicle.findAndCountAll({
      where: whereClause,
      offset: isNaN(parseInt(offset)) ? 0 : parseInt(offset),
      limit: isNaN(parseInt(limit)) ? 25 : parseInt(limit),
      order: [
        [Sequelize.literal(`(SELECT CASE WHEN COUNT(*) > 0 THEN 0 ELSE 1 END FROM bookings AS b WHERE b.vehicleId = vehicle.id AND b.status IN ('${BOOKING_BOOKED}', '${BOOKING_ONGOING}') AND ((b.startTime BETWEEN '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${endTime}' OR b.endTime BETWEEN '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${twoHoursAfterEnd.format('YYYY-MM-DD HH:mm:ss')}') OR (b.startTime <= '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND b.endTime >= '${twoHoursAfterEnd.format('YYYY-MM-DD HH:mm:ss')}')))`), 'DESC'],
        // `order` is an array of order items; spread it so it isn't nested as a
        // single element (which made Sequelize emit ``.`vehicle`.`col` -> the
        // "Incorrect database name ''" error).
        // `sortBy=distance` with no geo/city would emit a bare ' ASC'.
        ...(distanceQuery && sortBy === 'distance'
          ? [Sequelize.literal(`${distanceQuery} ASC`)]
          : distanceQuery && sortBy === '-distance'
          ? [Sequelize.literal(`${distanceQuery} DESC`)]
          : order)
      ],
      include: includeOptions,
      attributes: {
        include: [
          // Omitted entirely without a distance basis — `()` is a syntax error.
          ...(distanceQuery ? [[Sequelize.literal(`(${distanceQuery})`), 'distance']] : []),
          [Sequelize.literal(`
            (
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM bookings AS b 
                        WHERE 
                            b.vehicleId = vehicle.id 
                            AND b.status IN ('${BOOKING_BOOKED}', '${BOOKING_ONGOING}') 
                            AND (
                                (b.startTime BETWEEN '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${endTime}')
                                OR (b.endTime BETWEEN '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${twoHoursAfterEnd.format('YYYY-MM-DD HH:mm:ss')}')
                                OR (b.startTime <= '${twoHoursBeforeStart.format('YYYY-MM-DD HH:mm:ss')}' AND b.endTime >= '${twoHoursAfterEnd.format('YYYY-MM-DD HH:mm:ss')}')
                            )
                    ) THEN 0 
                    WHEN EXISTS (
                        SELECT 1 FROM scheduleBlocks AS sb 
                        WHERE sb.vehicleId = vehicle.id  
                        AND sb.deleted = false 
                        AND (
                            sb.startTime < '${moment(endDateTime).format('YYYY-MM-DD HH:mm:ss')}' 
                            AND sb.endTime > '${moment(startDateTime).format('YYYY-MM-DD HH:mm:ss')}'
                        )
                    ) THEN 0
                    WHEN NOT EXISTS (
                        SELECT 1 FROM vehicleplans AS vp
                        WHERE vp.vehicleId = vehicle.id
                        AND vp.startTime <= '${moment(startDateTime).format('YYYY-MM-DD HH:mm:ss')}'
                    ) THEN 0
                    WHEN NOT EXISTS (
                        SELECT 1 FROM schedules AS s
                        WHERE s.vehicleId = vehicle.id
                        AND s.startTime <= '${moment(startDateTime).format('YYYY-MM-DD HH:mm:ss')}'
                        AND s.endTime >= '${moment(endDateTime).format('YYYY-MM-DD HH:mm:ss')}'
                    ) THEN 0
                    ELSE 1 
                END
            )
        `), 'isAvailable'],
          [Sequelize.literal(discountedFeeQuery), 'discountedFee'],
          [Sequelize.literal(`${discountedFeeQuery} * (${endTime} - ${startTime}) / 3600`), 'totalFee']
        ]
      },
      having: havingClause.length > 0 ? Sequelize.literal(havingClause.join(' AND ')) : null,
      subQuery: false
    });

    if (startTime && endTime) {
      const durationInHours = (endDateTime - startDateTime) / (1000 * 60 * 60);

      if (durationInHours < 12) {
        throw new CustomError('The booking duration must be at least 12 hours.', 400, 'INVALID_DURATION');
      }

      return {
        count: vehicles.count,
        vehicles: vehicles.rows,
        maxDistance: maxValues.maxDistance || 0,
        maxPrice: maxValues.maxPrice || 0
      };

    } else {
      const vehiclesWithNextAvailable = await Promise.all(vehicles.rows.map(async (vehicle) => {
        const nextAvailable = await calculateNextAvailable(vehicle.id);
        return { ...vehicle.toJSON(), nextAvailable };
      }));

      return {
        count: vehicles.count,
        vehicles: vehiclesWithNextAvailable,
        maxDistance: maxValues.maxDistance || 0,
        maxPrice: maxValues.maxPrice || 0
      };
    }
  } catch (error) {
    throw error;
  }
};

const isVehicleAvailable = async (vehicleId, startTime, endTime) => {
  const twoHoursBeforeStart = moment(startTime).subtract(2, 'hours');
  const twoHoursAfterEnd = moment(endTime).add(2, 'hours');

  const overlappingTransaction = await Booking.findOne({
    where: {
      vehicleId,
      status: {
        [Op.in]: [BOOKING_BOOKED, BOOKING_ONGOING]
      },
      [Op.or]: [
        { startTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
        { endTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
        {
          [Op.and]: [
            { startTime: { [Op.lte]: twoHoursBeforeStart } },
            { endTime: { [Op.gte]: twoHoursAfterEnd } },
          ],
        },
      ],
    },
  });

  if (overlappingTransaction) {
    return false;
  }

  const vehicle = await Vehicle.findByPk(vehicleId);
  if (vehicle && vehicle.hostId) {
    const schedule = await Schedule.findOne({
      where: {
        vehicleId,
        deleted: false,
        startTime: { [Op.lte]: startTime },
        endTime: { [Op.gte]: endTime },
      },
    });

    if (!schedule) {
      return false;
    }

    const scheduleBlock = await ScheduleBlock.findOne({
      where: {
        scheduleId: schedule.id,
        deleted: false,
        [Op.or]: [
          { startTime: { [Op.between]: [startTime, endTime] } },
          { endTime: { [Op.between]: [startTime, endTime] } },
          {
            [Op.and]: [
              { startTime: { [Op.lte]: startTime } },
              { endTime: { [Op.gte]: endTime } },
            ],
          },
        ],
      },
    });

    if (scheduleBlock) {
      return false;
    }
  }

  return true;
};

const calculateNextAvailable = async (vehicleId) => {
  try {
    const minSlotDuration = 12 * 60 * 60 * 1000; // 14 hours in milliseconds
    const minGapDuration = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

    const roundToNextHour = (date) => {
      const result = new Date(date);
      result.setMinutes(0, 0, 0);
      result.setHours(result.getHours() + 1);
      return result;
    };

    const currentTime = roundToNextHour(new Date());

    // Fetch future bookings for the vehicle, ordered by startTime
    const futureBookings = await Booking.findAll({
      where: {
        vehicleId,
        endTime: {
          [Sequelize.Op.gt]: currentTime,
        },
      },
      order: [['startTime', 'ASC']],
      attributes: ['startTime', 'endTime'],
    });

    // If there are no future bookings, the next available slot starts 2 hours from now
    if (futureBookings.length === 0) {
      return new Date(currentTime.getTime() + minGapDuration);
    }

    // Check for available slot before the first future booking
    const firstBookingStartTime = roundToNextHour(futureBookings[0].startTime);
    const initialGap = firstBookingStartTime.getTime() - currentTime.getTime();
    if (initialGap >= minSlotDuration) {
      return new Date(currentTime.getTime() + minGapDuration);
    }

    // Iterate through the future bookings to find a gap
    for (let i = 0; i < futureBookings.length - 1; i++) {
      const currentEndTime = roundToNextHour(futureBookings[i].endTime);
      const nextStartTime = roundToNextHour(futureBookings[i + 1].startTime);
      const gapDuration = nextStartTime.getTime() - currentEndTime.getTime();

      // Check if the gap is sufficient for a 14-hour slot
      if (gapDuration >= minSlotDuration) {
        const nextAvailable = new Date(currentEndTime.getTime() + minGapDuration);
        if (nextAvailable > currentTime) {
          return nextAvailable;
        }
      }
    }

    // If no 14-hour gap is found, find the next available slot after the last booking with a 2-hour gap
    const lastBookingEndTime = roundToNextHour(futureBookings[futureBookings.length - 1].endTime);
    const nextAvailable = new Date(lastBookingEndTime.getTime() + minGapDuration);
    return nextAvailable > currentTime ? nextAvailable : currentTime;
  } catch (error) {
    console.error('Error calculating next available time:', error);
    throw error;
  }
};






const getVehicleById = async (id, startTime, endTime) => {
  try
  {
  console.log('start-end',endTime,startTime)
  const vehicle = await Vehicle.findOne({
    where: { vehicleId: id },
    include: [
      {
        model: Vendor,
        as: 'owner',
      },
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
        include:[{model:City,as:'city'}]
      },
      {
        model:VehiclePreference,
        as:'vehiclePreference'
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

  let membershipOffer = 0;
    
  // if (userIsPremium) {
    const membershipInfo = await getMembershipInfo();
    membershipOffer = membershipInfo.membershipRideOffer;
    

  if (startTime && endTime && vehicle) {
    const isAvailable = await isVehicleAvailable(vehicle.id, new Date(startTime*1000), new Date(endTime*1000));
    const discountedFee = vehicle.vehiclePlan[0].perHourFee * (1 - membershipOffer / 100);
    let vehiclePlan = vehicle.vehiclePlan[0].toJSON()
    vehiclePlan.offerHourFee = discountedFee;
    return { ...vehicle.toJSON(), isAvailable,vehiclePlan:[{...vehiclePlan}] };
    // return { ...vehicle.toJSON(), isAvailable };
  }

  return vehicle;
} catch (error) {
  console.error('Error calculating next available time:', error);
  throw error;
}
};



const createVehicle = async (vehicleData) => {
  let transaction;
  let vehicle;
  console.log('vehicle data',vehicleData)
  try {
    transaction = await db.transaction();

    let randomVehicleId;
    do {
      randomVehicleId = Math.floor(10000 + Math.random() * 90000);
    } while (await Vehicle.findOne({ where: { vehicleId: randomVehicleId }, transaction }));

    vehicleData.vehicleId = randomVehicleId;
    vehicleData.ownerId = (vehicleData.ownerId !== '' && vehicleData.ownerId) ? vehicleData.ownerId : null ;

    vehicle = await Vehicle.create({...vehicleData,features:vehicleData.features.join(',')}, { transaction });

    const { plan, ...restVehicleData } = vehicleData;

    const vehiclePlanData = {
      vehicleId: vehicle.id,
      startTime: new Date(),
      ...plan,
    };

    const vehiclePlan = await VehiclePlan.create(vehiclePlanData, { transaction });


    const imagePromises = vehicleData.images.map(async (image) => {
      return Image.create({
        vehicleId: vehicle.id,
        isCover: image.isCover ? true : false,
        url: image.src,
      }, { transaction });
    });

    await Promise.all(imagePromises);

    await transaction.commit();

    return { vehicle, vehiclePlan }
  } catch (error) {
    if (transaction) await transaction.rollback();

    if (vehicle) await vehicle.destroy();

    throw error; 
  }
};


const addVehicleImage = async (id, data) => {
  try {
    const vehicle = await Vehicle.findOne({where:{vehicleId:id}});
    if (data.url && data.url !='') {
        // Update vehiclePlan model
        let image = await Image.create({
          vehicleId: vehicle.id,
          isCover: false,
          url: data.url,
        });
      
      // await vehicle.update(updatedVehicleData);
      return image;
    }
    
    throw CustomError('Vehicle Not Found',500,'NOT_FOUND')
  } catch (error) {
    throw error instanceof CustomError ? error : new CustomError(`Error updating Vehicle : ${error.message}`, 500, 'INTERNAL_ERROR');
  }
  };

  const removeVehicleImage = async (id) => {
  try {
    let image = await Image.findByPk(id);
    if(image.isCover) throw CustomError('Cover Image cannot be removed',500,'CANNOT_REMOVE_IMAGE') 
    else image.destroy();
      return {status:'Image Removed'};
  } catch (error) {
    throw error instanceof CustomError ? error : new CustomError(`Error updating Vehicle : ${error.message}`, 500, 'INTERNAL_ERROR');
  }
  };

  const changeCoverImage = async (id,vehicleId) => {
    let transaction;
  try {
    transaction = await db.transaction();
    let vehicleInfo =await Vehicle.findOne({where:{vehicleId:vehicleId}})
    await Image.update({isCover:false},{where:{vehicleId:vehicleInfo.id}},{transaction:transaction});
    await Image.update({isCover:true},{where:{id:id}},{transaction:transaction})
    await transaction.commit();
    // if(image.isCover) throw CustomError('Cover Image cannot be removed',500,'CANNOT_REMOVE_IMAGE') 
    // else image.destroy();
      return {status:'Cover Image Updated'};
  } catch (error) {
    if (transaction) await transaction.rollback();
    throw error instanceof CustomError ? error : new CustomError(`Error updating Vehicle : ${error.message}`, 500, 'INTERNAL_ERROR');
  }
  };

const updateVehicle = async (id, updatedVehicleData) => {
  try {
    console.log('id',updatedVehicleData)
    const vehicle = await Vehicle.findOne({where:{vehicleId:id}});
    if (vehicle) {
      if (updatedVehicleData.vehiclePlan) {
        // Update vehiclePlan model
        await VehiclePlan.update({perHourFee:parseInt(updatedVehicleData.vehiclePlan.perHourFee),extraKmFee:parseInt(updatedVehicleData.vehiclePlan.extraKmFee),kmAlloted:parseInt(updatedVehicleData.vehiclePlan.kmAlloted)}, { where: { vehicleId: vehicle.id } });
      }
      
      await vehicle.update({...updatedVehicleData,features:updatedVehicleData.features && updatedVehicleData.features.length > 0 ? updatedVehicleData.features.join(',') : ''});
      return vehicle;
    }
    
    throw CustomError('Vehicle Not Found',500,'NOT_FOUND')
  } catch (error) {
    console.log(error)
    throw error instanceof CustomError ? error : new CustomError(`Error updating Vehicle : ${error.message}`, 500, 'INTERNAL_ERROR');
  }
  };

const deleteVehicle = async (id) => {
  const vehicle = await Vehicle.findOne({where:{vehicleId:id}});
  if (vehicle) {
    await vehicle.update({ deleted: true });
    return true;
  }
  return false;
};


const verifyRc = async (rcNumber,userId)=>
{
  try 
  {
    let res  =  await axios.post(`${process.env.KYC_URL}/verification/vehicle-rc`,{verification_id:data.rcNumber},{headers:{'x-client-id':`${process.env.KYC_ID}`,'x-client-secret':`${process.env.KYC_SECRET}`}})
    
  } catch (error) {
    console.log(error)
    throw new CustomError('Error verifying RC',500,'INTERNAL_ERROR')
  }
}
  

module.exports = {
  addVehicleImage,
  getAllVehicles,
  getVehicleById,
  changeCoverImage,
  createVehicle,
  updateVehicle,
  removeVehicleImage,
  deleteVehicle,
  verifyRc
};
