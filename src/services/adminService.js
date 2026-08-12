const express = require('express');
const router = express.Router();
const Admin = require('../models/admin');
const {getAuth} = require('firebase-admin/auth')
const { v4: uuidv4 } = require('uuid');
const adminAuth = require('../helper/adminAuth');
const userAuth = require('../helper/userAuth');
const User = require('../models/user');
const { default: axios } = require('axios');
const ExcelJS = require('exceljs');
const Vehicle = require('../models/vehicle');
const Pickup = require('../models/pickuppoint');
const VehiclePlan = require('../models/vehicleplan');
const Vendor = require('../models/vendor');
const Image = require('../models/image');
const Brand = require('../models/brand');
const City = require('../models/city');
const Schedule = require('../models/schedule');
const ScheduleBlock = require('../models/scheduleBlock');
const { CustomError } = require('../middlewares/error');
const Host = require('../models/host');
const HostCommission = require('../models/hostCommission');
const { Op } = require('sequelize');
const Booking = require('../models/booking');
const Review = require('../models/review');
const HostReview = require('../models/hostReview');
const RazorpayInstance = require('../helper/payment');
const db = require('../configs/db');
const { ADMIN_ROLES } = require('../utils/adminRoles');
const { logActivity, getActivityLogs } = require('./activityLogService');
const documentStore = require('./documentStoreService');

const createAdmin = async(userData, actingAdmin) => {
  try {
  const firebaseInfo = await adminAuth
  .createUser({
    email: userData.email,
    emailVerified: false,
    phoneNumber: `+91${userData.mobile}`,
    password: uuidv4(),
    displayName: userData.name,
    // photoURL: 'http://www.example.com/12345678/photo.png',
    // disabled: false,
  })
    // `permission` was never a real column on the admin model (Sequelize
    // silently drops unknown attributes) — new admins always got the model's
    // default role regardless of what was passed. Use the real `role` field.
    const adminInfo = await Admin.create({
      name: firebaseInfo.displayName,
      email: firebaseInfo.email,
      uid: firebaseInfo.uid,
      mobile: userData.mobile,
      role: userData.role ?? ADMIN_ROLES.PLATFORM_ADMIN,
      // Data-driven team + level (see adminTeamService). Optional — an admin
      // created without one falls back to the legacy role matrix.
      teamId: userData.teamId ?? null,
      teamLevelId: userData.teamLevelId ?? null,
    });

    await logActivity({
      adminId: actingAdmin?.id,
      adminName: actingAdmin?.name,
      action: 'create',
      entityType: 'Admin',
      entityId: adminInfo.id,
      changes: { created: adminInfo.toJSON() },
    });

    // The account is created with a random password nobody knows — there is
    // no "forgot password" page wired up in the admin panel yet (the login
    // page links to one, but the route doesn't exist), so without this the
    // new admin would have no way to ever sign in. Hand back a Firebase
    // password-reset link for whoever created the account to pass along.
    let resetLink = null;
    try {
      resetLink = await adminAuth.generatePasswordResetLink(firebaseInfo.email);
    } catch (linkError) {
      console.error('Could not generate password reset link for new admin:', linkError);
    }

    return { ...adminInfo.toJSON(), resetLink };
  } catch (error) {
    console.error(error);
    throw new Error('Error creating user: ' + error.message);
  }
}

const createUser = async(userData) => {
  try {
  const firebaseInfo = await userAuth
  .createUser({
    email: userData.email ? userData.email : '',
    emailVerified: false,
    phoneNumber: `+91${userData.mobile}`,
    displayName: userData.name ? userData.name : '',
    // photoURL: 'http://www.example.com/12345678/photo.png',
    // disabled: false,
  })
    const adminInfo = await User.create({name:firebaseInfo.displayName,email:firebaseInfo.email,id:firebaseInfo.uid,contactNumber:userData.contactNumber});
    return adminInfo;
  } catch (error) {
    console.error(error);
    throw new Error('Error creating user: ' + error.message);
  }
}

const getAllVehicles = async ({searchTerm,  sortBy='vehicleName', filters, startTime, endTime, status = true, approved, limit = 10, offset=0,hostId}) => {
  try {
    // if (!checkTimeGaps(startTime, endTime)) return false;
    console.log('filters', filters);
    const whereClause = searchTerm
      ? {
          deleted: false,
          [Op.or]: [
            { vehicleName: { [Op.like]: `%${searchTerm}%` } },
            { vehicleBrand: { [Op.like]: `%${searchTerm}%` } },
          ],
        }
      : { deleted: false };

    // `approved` powers Vehicles > Approvals ("approve or reject vehicles").
    // NOTE: the pre-existing `status` param is destructured above but has
    // never been applied to the query — it is a no-op. Left alone rather than
    // repurposed, since other callers may already be passing it and would
    // silently change behaviour. Use `approved` for approval filtering.
    if (approved !== undefined) {
      whereClause.isAdminApproved = approved === true || approved === 'true';
      // "Not approved" means awaiting review — a rejected vehicle is a
      // different queue and must not appear in the approvals list.
      if (whereClause.isAdminApproved === false) whereClause.approvalStatus = 'pending';
      // A draft was never submitted for approval, so it isn't "pending".
      if (whereClause.isAdminApproved === false) whereClause.isDraft = false;
    }

    if (filters) {
      if (filters.type) {
        const types = filters.type.toLowerCase().split(',');
        if (types.includes('luxury')) {
          console.log('types luxury', types);
          whereClause.isLuxury = true;
          whereClause.vehicleType = { [Op.in]: types.filter(type => type !== 'luxury') };
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
          whereClause.isDeliveryAvailable = true;
        }
        if (deliveryTypes.includes('pickup')) {
          whereClause.isPickupAvailable = true;
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
        model:Host,
        as:'host',
        // Explicit, because Sequelize infers `required` from the PRESENCE of a
        // `where` key. Only narrow to one host when actually filtering by one.
        ...(hostId ? { where: { id: hostId }, required: true } : { required: false }),
      },
      {
        model: VehiclePlan,
        as: 'vehiclePlan',
        attributes: ['perHourFee'],
        order: [['startTime', 'DESC']],
        limit: 1,
      },
      {
        model: Pickup,
        as: 'pickupPoint',
        // THIS IS WHY THE OPS VEHICLES LIST CAME BACK EMPTY.
        //
        // The old code passed `where: {}` when there was no city filter. An
        // empty object is still an object, and Sequelize decides `required`
        // from whether a `where` key is PRESENT, not whether it constrains
        // anything — so `{}` silently turned this into an INNER JOIN and every
        // vehicle without a pickup row disappeared from the list.
        //
        // Vehicles get their pickup progressively (the listing wizard's
        // Location step; see `isPickupAdded` in hostService), so a car that is
        // mid-listing or was never given a location has no `pickups` row at
        // all. Those are exactly the vehicles ops needs to see — a car in
        // review is the reason to open this screen.
        //
        // So: LEFT JOIN by default, and only INNER JOIN when a city filter is
        // genuinely being applied, where excluding pickup-less vehicles is the
        // intended meaning.
        ...(filters && filters.city
          ? { where: { cityId: filters.city }, required: true }
          : { required: false }),
        include:[{model:City,as:'city',required:false}]
      }
    ];

    let vehicles = await Vehicle.findAll({
      where: whereClause,
      offset: isNaN(parseInt(offset)) ? 0 : parseInt(offset),
      limit: isNaN(parseInt(limit)) ? 25 : parseInt(limit),
      order,
      include: includeOptions,
    });

    const totalCount = await Vehicle.count({
      where: whereClause,
      include: includeOptions
    });

    return {
      vehicles,
      totalCount
    };
  } catch (error) {
    throw error;
  }
};

const getAllAdmins = async () => {
  try {
    const admins = await Admin.findAll();
    return admins;
  } catch (error) {
    throw new Error('Error getting users: ' + error.message);
  }
};

// Edits an admin's profile + access (name/email/mobile/role/isActive).
// name/email/mobile are also pushed to the underlying Firebase user —
// Firebase is where the admin actually signs in, so an edit that changed only
// the DB row would leave them signing in with stale credentials.
const updateAdminAccess = async (id, { name, email, mobile, role, isActive, teamId, teamLevelId }, actingAdmin) => {
  try {
    const admin = await Admin.findByPk(id);
    if (!admin) throw new CustomError('Admin not found', 404);

    const before = admin.toJSON();
    const fields = {};
    if (name !== undefined) fields.name = name;
    if (email !== undefined) fields.email = email;
    if (mobile !== undefined) fields.mobile = mobile;
    if (role !== undefined) fields.role = role;
    if (isActive !== undefined) fields.isActive = isActive;
    // Team + level assignment (data-driven access).
    if (teamId !== undefined) fields.teamId = teamId;
    if (teamLevelId !== undefined) fields.teamLevelId = teamLevelId;

    const firebaseUpdates = {};
    if (fields.name !== undefined) firebaseUpdates.displayName = fields.name;
    if (fields.email !== undefined) firebaseUpdates.email = fields.email;
    if (fields.mobile !== undefined) firebaseUpdates.phoneNumber = `+91${fields.mobile}`;
    if (Object.keys(firebaseUpdates).length > 0) {
      try {
        await adminAuth.updateUser(admin.uid, firebaseUpdates);
      } catch (firebaseError) {
        console.error('Could not update Firebase admin record (continuing with DB update):', firebaseError.message);
      }
    }

    await admin.update(fields);

    const changed = {};
    Object.keys(fields).forEach((key) => {
      if (before[key] !== fields[key]) changed[key] = { from: before[key], to: fields[key] };
    });
    if (Object.keys(changed).length > 0) {
      await logActivity({
        adminId: actingAdmin?.id,
        adminName: actingAdmin?.name,
        action: 'update',
        entityType: 'Admin',
        entityId: id,
        changes: changed,
      });
    }

    return admin;
  } catch (error) {
    throw error;
  }
};

// Removes the admin's Firebase account too, not just the DB row — otherwise
// the next boot-time sync would just re-insert them. An admin cannot delete
// their own account (avoids an accidental self-lockout).
const deleteAdmin = async (id, actingAdmin) => {
  const admin = await Admin.findByPk(id);
  if (!admin) throw new CustomError('Admin not found', 404);
  if (actingAdmin && admin.id === actingAdmin.id) {
    throw new CustomError('You cannot delete your own account', 400);
  }

  try {
    await adminAuth.deleteUser(admin.uid);
  } catch (firebaseError) {
    console.error('Could not delete Firebase admin record (continuing with DB delete):', firebaseError.message);
  }

  const snapshot = admin.toJSON();
  await admin.destroy();

  await logActivity({
    adminId: actingAdmin?.id,
    adminName: actingAdmin?.name,
    action: 'delete',
    entityType: 'Admin',
    entityId: id,
    changes: { deleted: snapshot },
  });

  return { success: true };
};

const getUserInfo = async (id) => {
  try {
    const admins = await User.findByPk(id);
    return admins;
  } catch (error) {
    throw new Error('Error getting users: ' + error.message);
  }
};

const getKycInformation = async (userId)=> {
  try {
    let user = await User.findOne({ where: { id: userId } });
    console.log('running')
    let res  =  await axios.get(`${process.env.KYC_URL}/verification/offline-aadhaar/${user.kycRef}`,{headers:{'x-client-id':`${process.env.KYC_ID}`,'x-client-secret':`${process.env.KYC_SECRET}`}})
    if(res.data.status !== 'VALID') throw(res.data.status)
  console.log('uer',user)
    return {user:user,kycInfo:res.data};
  } catch (error) {
    // Handle errors appropriately (e.g., log the error, throw an exception)
    console.error('Error in precheck:', error);
    throw error;
  }
}

const verifyKycManual = async (userId)=> {
  try {
    // Verification now lives on the document row, not a user column.
    const doc = await documentStore.getCurrent('kyc', userId);
    if (!doc) throw new CustomError('This user has no KYC document on file', '404');
    await doc.update({ status: 'verified', verifiedAt: new Date(), rejectionReason: null });
    return await documentStore.withUserDocuments(await User.findByPk(userId));
  } catch (error) {
    // Handle errors appropriately (e.g., log the error, throw an exception)
    console.error('Error in precheck:', error);
    throw error;
  }
}

const verifyLicense = async (userId)=> {
  try {
    const doc = await documentStore.getCurrent('licence', userId);
    if (!doc) throw new CustomError('This user has no licence on file', '404');
    await doc.update({ status: 'verified', verifiedAt: new Date(), rejectionReason: null });
    return await documentStore.withUserDocuments(await User.findByPk(userId));
  } catch (error) {
    // Handle errors appropriately (e.g., log the error, throw an exception)
    console.error('Error in precheck:', error);
    throw error;
  }
}


const getSchedules = async ({userId, vehicleId, sort='createdAt', offset=0, limit=10, status, hostId, searchTerm})=>{
  try {
    const whereClause = {};
    
    // Add filters to where clause if provided
    if (userId) whereClause.userId = userId;
    if (vehicleId) whereClause.vehicleId = vehicleId;
    if (status) whereClause.status = status;
    if (hostId) whereClause.hostId = hostId;

    // Add search functionality
    if (searchTerm) {
      whereClause[Op.or] = [
        { vehicleName: { [Op.like]: `%${searchTerm}%` } },
        { location: { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    // Get total count for pagination
    const total = await Schedule.count({ where: whereClause });

    // Get paginated and sorted results
    const schedules = await Schedule.findAll({
      where: whereClause,
      order: [[sort, 'DESC']],
      offset: parseInt(offset),
      limit: parseInt(limit),
      include: [
        {
          model: Vehicle,
          as:'vehicle',
          attributes: ['vehicleName', 'vehicleBrand', 'vehicleType','vehicleNumber']
        },
        {
          model:ScheduleBlock,
          as:'scheduleBlocks',
          attributes:['startTime','endTime','status']
        }
      ]
    });

    return {
      schedules,
      count:total
    };

  } catch (error) {
    console.error('Error getting schedules:', error);
    throw new CustomError('Error getting schedules: ' + error.message,'500');
  }
}


const getScheduleById = async (id)=>{
  try {
    const schedule = await Schedule.findByPk(id,{
      include:[
        {
          model:ScheduleBlock,
          as:'scheduleBlocks',
          attributes:['startTime','endTime','status']
        },
        {
          model:Vehicle,
          attributes:['vehicleName','vehicleBrand','vehicleType']
        }
      ]
    })
    return schedule;
  } catch (error) {
    throw new CustomError('Error getting schedule: ' + error.message,'500');
  }
}


// const getAllVehicles = async ()=>{
//   try 
//   {
//     const vehicles = await Vehicle.findAll({
//       include:[
//         {
//           model:Host,
//           as:'host',
//           attributes:['name','email','contactNumber']
//         },
//         {
//           model:Image,
//           as:'images',
//           attributes:['url','isCover']
//         },
//         {
//           model:Brand,
//           as:'brand',
//           attributes:['name']
//         },
//         {
//           model:Pickup,
//           as:'pickupPoint',
//           include:[{model:City,as:'city',required:false}]
//         },
//         {
//           model:VehiclePlan,
//           as:'vehiclePlan',
//           attributes:['perHourFee','weekendFee','weekdayFee','id']
//         },
//         {
//           model:Schedule,
//           as:'schedules',
//           attributes:['id','status','userId','vehicleId','hostId'],
//           include:[
//             {
//               model:ScheduleBlock,
//               as:'scheduleBlocks',
//               attributes:['id','startTime','endTime','status']
//             }
//           ]
//         }
//       ]
//     })
//     return vehicles;
//   } catch (error) {
//     throw new CustomError('Error getting vehicles: ' + error.message,'500');
//   }
// }


const getVehicleById = async (id,rc=false) => {
  try
  {
  const vehicle = await Vehicle.findOne({
    where: { id: id },
    include: [
      {
        model: Host,
        as: 'host',
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

  // The provider's verification id lives on the RC document now.
  const rcDoc = await documentStore.getCurrent('rc', vehicle.id);

  let rcVerificationData = {};
  if(rc && rcDoc?.verificationId){
    let res = await axios.get(`${process.env.KYC_URL}/verification/vehicle-rc`, {
      headers: {
        'x-client-id': `${process.env.KYC_ID}`,
        'x-client-secret': `${process.env.KYC_SECRET}`
      },
      params: {
        verification_id: rcDoc.verificationId
      }
    })
    rcVerificationData = res.data;
  }

  return {...vehicle.toJSON(), ...documentStore.projectVehicleRc(rcDoc), rcVerificationData};
} catch (error) {
  console.error('Error getting vehicle:', error);
  throw error;
}
};


const approveVehicle = async (id, admin) =>
{
  try {
    const existingVehicle = await Vehicle.findByPk(id);
    if (!existingVehicle) {
      throw new CustomError('Vehicle not found', '404');
    }
    if (existingVehicle.isAdminApproved) {
      throw new CustomError('Vehicle is already approved', '400');
    }
    await Vehicle.update({
      isAdminApproved: true,
      approvalStatus: 'approved',
      // Clear any earlier rejection so the host stops seeing a stale reason
      // against a vehicle that is now live.
      rejectionReason: null,
      reviewedAt: new Date(),
      reviewedByAdminId: admin?.id || null,
    }, { where: { id } });

    await logActivity({
      adminId: admin?.id, adminName: admin?.name, action: 'approve',
      entityType: 'Vehicle', entityId: id,
      changes: { approvalStatus: { from: existingVehicle.approvalStatus, to: 'approved' } },
    });

    return await Vehicle.findByPk(id);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError('Error approving vehicle: ' + error.message,'500');
  }
}

// Suspension takes a live vehicle off the platform without touching its data
// or its history. Unlike rejection it is not part of the review workflow — an
// approved vehicle can be suspended and later restored to approved.
const setVehicleSuspension = async (id, suspended, reason, admin) =>
{
  const vehicle = await Vehicle.findByPk(id);
  if (!vehicle) throw new CustomError('Vehicle not found', '404');

  if (suspended) {
    const text = String(reason || '').trim();
    if (!text) throw new CustomError('A reason is required when suspending a vehicle', '400');

    await Vehicle.update({
      approvalStatus: 'suspended',
      suspensionReason: text,
      suspendedAt: new Date(),
      // Drops it out of every public listing query, which all gate on this.
      isAdminApproved: false,
      reviewedByAdminId: admin?.id || null,
    }, { where: { id } });
  } else {
    if (vehicle.approvalStatus !== 'suspended') {
      throw new CustomError('This vehicle is not suspended', '400');
    }
    // Restoring returns it to approved — it passed review before, and
    // suspension is not a re-review.
    await Vehicle.update({
      approvalStatus: 'approved',
      suspensionReason: null,
      suspendedAt: null,
      isAdminApproved: true,
      reviewedByAdminId: admin?.id || null,
    }, { where: { id } });
  }

  await logActivity({
    adminId: admin?.id, adminName: admin?.name,
    action: suspended ? 'suspend' : 'restore',
    entityType: 'Vehicle', entityId: id,
    changes: { approvalStatus: { from: vehicle.approvalStatus, to: suspended ? 'suspended' : 'approved' },
               reason: suspended ? String(reason || '').trim() : null },
  });

  return await Vehicle.findByPk(id);
}

// Rejection requires a reason: the whole point is that the host is told what
// to fix, so "edit and resubmit" is actually possible.
const rejectVehicle = async (id, reason, admin) =>
{
  const text = String(reason || '').trim();
  if (!text) {
    throw new CustomError('A reason is required when rejecting a vehicle', '400');
  }

  const existingVehicle = await Vehicle.findByPk(id);
  if (!existingVehicle) {
    throw new CustomError('Vehicle not found', '404');
  }

  await Vehicle.update({
    isAdminApproved: false,
    approvalStatus: 'rejected',
    rejectionReason: text,
    reviewedAt: new Date(),
    reviewedByAdminId: admin?.id || null,
  }, { where: { id } });

  await logActivity({
    adminId: admin?.id, adminName: admin?.name, action: 'reject',
    entityType: 'Vehicle', entityId: id,
    changes: {
      approvalStatus: { from: existingVehicle.approvalStatus, to: 'rejected' },
      rejectionReason: { from: existingVehicle.rejectionReason, to: text },
    },
  });

  return await Vehicle.findByPk(id);
}





async function getAllBookings({userId,startTime,endTime, sort, offset, search,limit,vehicleId,status,cityId,hostId}) {
  try {
    // Construct query based on filters
    let queryOptions = {
      include: [
        {
          model: Vehicle,
          as: 'vehicle',
          include:[
            {
              model:Pickup,
              as:'pickupPoint',
              include:[
                {
                  model:City,
                  as:'city',
                  where: cityId ? { id: cityId } : undefined,
                  required: true
                }
              ],
              required: true,
            }
          ],
          required: true,
          where: hostId ? { hostId: hostId } : undefined
        },
        {
          model: User,
          as: 'user',
        },
        {
          model:Review,
          as:'review'
        },
        {
          model:HostReview,
          as:'hostReview'
        }
      ],
    };

      if (userId) {
        queryOptions.where = { ...queryOptions.where, userId: userId };
      }
      if (vehicleId) {
        queryOptions.where = { ...queryOptions.where, vehicleId: vehicleId };
      }
      if (status) {
        queryOptions.where = { ...queryOptions.where, status: status };
      }
      if (startTime && endTime) {
        queryOptions.where = {
          ...queryOptions.where,
          createdAt: { [Op.between]: [startTime, endTime] }
        };
      }

      // if (cityId) {
      //   queryOptions.include[0].include[0].where = { cityId: cityId };
      // }

    // Handle sorting
    queryOptions.order = [['createdAt', 'DESC']];
    if (sort) {
      const orderDirection = sort.startsWith('-') ? 'DESC' : 'ASC';
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort; // Remove the '-' for the field name
      queryOptions.order = [[sortField, orderDirection]];
    }
    // Handle offset
    if (offset) {
      queryOptions.offset = parseInt(offset);
    }
    
    if (limit) {
      queryOptions.limit = parseInt(limit);
    }
    
    // Handle search
    if (search) {
      queryOptions.where = {
        ...queryOptions.where,
        [Op.or]: [
          { 'bookingId': { [Op.like]: `%${search}%` } },
          { 'vehicleId': { [Op.like]: `%${search}%` } },
          { '$user.name$': { [Op.like]: `%${search}%` } },
          // { '$user.lastName$': { [Op.like]: `%${search}%` } },
          // Add more fields to search here
        ],
      };
    }

    // Fetch all bookings with related information based on constructed query
    const bookings = await Booking.findAll(queryOptions);

    // Count total number of bookings
    const totalCount = await Booking.count(queryOptions);

    return { data: bookings, totalCount };
  } catch (error) {
    throw new Error('Error getting bookings: ' + error.message);
  }
}


async function getBookingById(bookingId) {
  try {
    // Fetch a specific booking with related information by ID
    const booking = await Booking.findOne({
      where:{bookingId: bookingId}, 
    include: [
      {
        model: Refund,
        as: 'refunds'
      },
      {
        model: Transaction,
        as: 'transaction'
      },
      {
        model:HostReview,
        as:'hostReview'
      },
      {
        model:Review,
        as:'review'
      },
      {
        model: Image,
        as: 'images'
      },
      {
        model: Host,
        as: 'host'
      },
      {
        model: Vehicle,
        as: 'vehicle',
        include:[
          {
            model: Host,
            as: 'host'
          },
          {
            model: Pickup,
            as: 'pickupPoint',
            attributes:['id','name','lat','long','cityId'],
            include:[
              {
                model: City,
                as: 'city',
                attributes:['id','name']
              }
            ]
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
            model: VehiclePlan,
            as: 'vehiclePlan',
          },
        ]
      },
    ],
  },);
  // let review = await Review.findOne({where:{bookingId:booking.id}})
  // console.log('boboking',booking.dataValues.orderId)
  let res = {};
  let refundRes = [];
  if(booking.transaction && booking.transaction.paymentId) res = await RazorpayInstance.payments.fetch(booking.transaction.paymentId);
  if(booking.refundedAmount > 0)
  {
    refundRes = await Refund.findAll({where:{bookingId:booking.id},plain:true})
  }

    return {...booking.toJSON(),payment:res,refunds:refundRes};
  } catch (error) {
    console.log('error',error)
    throw new CustomError(error.message, 400);
  }
}


const getHostReviews = async ({hostId,userId,vehicleId,bookingId})=>{
  try {
    const reviews = await HostReview.findAll({where:{hostId:hostId}})
    return reviews;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
}

const getUserReviews = async ({userId,vehicleId,bookingId,hostId})=>{
  try {
    const reviews = await Review.findAll({where:{userId:userId}})
    return reviews;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
}
const getHostReviewsById = async (id)=>{
  try {
    const reviews = await HostReview.findByPk(id)
    return reviews;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
}
const exportUsers = async ()=> {
try {
  // Fetch data from the database. Document fields live in their own tables
  // now, so each user is flattened through the legacy projection to keep the
  // exported columns identical.
  const rows = await User.findAll();
  const users = await Promise.all(rows.map((u) => documentStore.withUserDocuments(u)));

  // Create a new workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Users');

  // Define the header for the Excel sheet
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 50 },
    { header: 'Contact Number', key: 'contactNumber', width: 40 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'License Verified', key: 'licenseVerified', width: 20 },
    { header: 'License Front', key: 'licenseFrontImage', width: 20 },
    { header: 'License Back', key: 'licenseBackImage', width: 20 },
    { header: 'KYC Verified', key: 'kycVerified', width: 20 },
    { header: 'Created At', key: 'createdAt', width: 25 },
    // Add more fields as necessary
  ];

  // Add rows to the worksheet
  users.forEach(user => {
    worksheet.addRow({
      name: user.name,
      contactNumber: user.contactNumber,
      email: user.email,
      licenseVerified: user.licenseVerified,
      licenseFrontImage: user.licenseFrontImage,
      licenseBackImage: user.licenseBackImage,
      kycVerified: user.kycVerified,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : '',
    });
  });

  const csvBuffer = await workbook.csv.writeBuffer();

    // Convert buffer to string
    return csvBuffer.toString('utf-8');
} catch (error) {
  console.log(error)
  throw new Error('Error generating Excel file: ' + error.message);
}
}

const getHostCommissionsByHostId = async (hostId) => {
  try {
    const commissions = await HostCommission.findAll({
      where: { hostId },
      order: [['startDate', 'DESC']]
    });

    return commissions;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

const addHostCommissionByAdmin = async (hostId, commissionData) => {
  const transaction = await db.transaction();
  try {
    const host = await Host.findByPk(hostId);
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
      where: { hostId, isActive: true },
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
      hostId,
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

const updateHostCommissionByAdmin = async (commissionId, commissionData) => {
  try {
    const commission = await HostCommission.findByPk(commissionId);
    if (!commission) throw new CustomError('Commission not found', 404);

    // If we're updating to isActive = true, deactivate other active commissions
    if (commissionData.isActive === true && !commission.isActive) {
      await HostCommission.update(
        { isActive: false },
        { where: { hostId: commission.hostId, isActive: true } }
      );
    }

    await commission.update(commissionData);
    return commission;
  } catch (error) {
    throw new CustomError(error.message, 400);
  }
};

module.exports = {createAdmin,createUser,getAllAdmins,getUserInfo,verifyKycManual,verifyLicense,getKycInformation,exportUsers,getAllVehicles,getSchedules,getScheduleById,getVehicleById,getAllBookings,getBookingById,approveVehicle,getHostCommissionsByHostId,addHostCommissionByAdmin,updateHostCommissionByAdmin,updateAdminAccess,deleteAdmin,getActivityLogs}