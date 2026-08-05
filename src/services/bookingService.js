const Brand = require('../models/brand');
const Image = require('../models/image');
const Booking = require('../models/booking');
const User = require('../models/user');
const Vehicle = require('../models/vehicle');
const VehiclePlan = require('../models/vehicleplan');
const Transaction = require('../models/transaction');
const Extension = require('../models/extension');
const {createPaymentOrder} = require('./paymentService');
const { Op, Sequelize } = require('sequelize');
var uniqid = require('uniqid'); 
const moment = require('moment')
const rideOtp = require('./rideOtpService');

const db = require('../configs/db');
const { TRANSACTION_TYPE_BOOKING, TRANSACTION_AUTHORIZED, BOOKING_BOOKED, BOOKING_CANCELLED, BOOKING_ONGOING, REFUND_PENDING, BOOKING_FINISHED, TRANSACTION_TYPE_EXTENSION, EXTENSION_INITIATED, EXTENSION_DONE, CONVENIENCE_FEE, DRIVER_FEE, DEPOSIT_AMOUNT, FIRST_TIME_OFFER, RESCHEDULE_FEE, TRANSACTION_TYPE_RESCHEDULE, RESCHEDULE_INITIATED, RESCHEDULE_DONE, TRANSACTION_CAPTURED, MAX_POINTS_USAGE } = require('../configs/constants');
const { precheck } = require('./userService');
const { CustomError } = require('../middlewares/error');
const RazorpayInstance = require('../helper/payment');
const { getMembershipInfo } = require('./membershipTypeService');
const Refund = require('../models/refund');
const { calculateRefund, convertToUnixTimestamp, findItemByType, getHoursDifference } = require('../helper/utils');
const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const Review = require('../models/review');
const { getAllSettings } = require('./settingsService');
const { getVehicleById } = require('./vehicleService');
const eventEmitter = require('../utils/eventEmitter');
const City = require('../models/city');
const Pickup = require('../models/pickuppoint');
const Conversation = require('../models/conversation');
const Schedule = require('../models/schedule');
const ScheduleBlock = require('../models/scheduleBlock');
const Wallet = require('../models/wallet');
const WalletTransaction = require('../models/wallettransaction');
const Host = require('../models/host');
const HostReview = require('../models/hostReview');
const Reschedule = require('../models/reschedule');
const Damage = require('../models/damage');
const ProtectionPlan = require('../models/protectionplan');

async function isSlotFree(vehicleId, startDateTime, endDateTime, id = null) {
    const twoHoursBeforeStart = moment(startDateTime).subtract(2, 'hours');
    const twoHoursAfterEnd = moment(endDateTime).add(2, 'hours');

    const overlappingTransaction = await Booking.findOne({
        where: {
            vehicleId,
            ...(id && { id: { [Op.ne]: id } }),
            [Op.or]: [
                {
                    status: BOOKING_BOOKED,
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
                {
                    status: BOOKING_ONGOING,
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
            ],
        },
    });

    if (overlappingTransaction) {
        return false;
    }

    const vehicle = await Vehicle.findByPk(vehicleId);
    if (vehicle && vehicle.hostId) {
        const scheduleExists = await Schedule.findOne({
            where: {
                vehicleId,
                startTime: { [Op.lte]: startDateTime },
                endTime: { [Op.gte]: endDateTime },
                deleted: false,
            },
        });

        if (!scheduleExists) {
            return false;
        }

        const scheduleBlockExists = await ScheduleBlock.findOne({
            where: {
                vehicleId,
                [Op.or]: [
                    { startTime: { [Op.between]: [startDateTime, endDateTime] } },
                    { endTime: { [Op.between]: [startDateTime, endDateTime] } },
                    {
                        [Op.and]: [
                            { startTime: { [Op.lte]: startDateTime } },
                            { endTime: { [Op.gte]: endDateTime } },
                        ],
                    },
                ],
                deleted: false,
            },
        });

        if (scheduleBlockExists) {
            return false;
        }
    }

    return true;
}


async function getLastBooking(userId) {
  try {
    const lastBooking = await Booking.findOne({
      where: { userId,status:BOOKING_FINISHED },
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: Vehicle,
          as: 'vehicle',
          include: [
            {
              model:Brand,
              as:'brand',
            },
            {
              model:Image,
              as:'images',
            }
          ]
        },
        {
          model: Review,
          as: 'review',
          required: false,
        },
      ],
    });

    if (!lastBooking) {
      return null;
    }

    const carInfo = {
      booking: lastBooking,
      review: lastBooking.review || null,
    };

    return carInfo;
  } catch (error) {
    throw new CustomError('Error fetching last booking', error);
  }
}
  
  async function bookingSummary({ userId, vehicleId, startTime, endTime }) {
      let trans;
    
      try {
          let res = {}
          if(userId) res = await precheck(userId)
          const startDateTime = new Date(startTime * 1000);
          const endDateTime = new Date(endTime * 1000);
  
          const isSlotFreeFlag = await isSlotFree(vehicleId, startDateTime, endDateTime);
          if (!isSlotFreeFlag) {
            throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
          }
  
          let lastBooking = null; 
          if(userId) 
            {
              lastBooking = await Booking.findOne({
                where: {
                  userId: userId,
                  status: {
                    [Sequelize.Op.in]: [BOOKING_BOOKED, BOOKING_FINISHED, BOOKING_ONGOING]
                  }
                }
              });
            }

          let vehicleInfo = await getVehicleById(vehicleId,startTime,endTime)
          let rideAmount = getHoursDifference(startDateTime,endDateTime)*(res.isPremium ? vehicleInfo.vehiclePlan[0].offerHourFee : vehicleInfo.vehiclePlan[0].perHourFee)
          let offerAmount = 0;
          let settings = await getAllSettings()
          if(userId && !lastBooking && !res.isPremium)
          {
            const firstTimeOfferPercentage = findItemByType(settings, FIRST_TIME_OFFER)?.value ? parseFloat(findItemByType(settings, FIRST_TIME_OFFER).value) / 100 : 0;
            offerAmount = Math.round(getHoursDifference(startDateTime,endDateTime)*(vehicleInfo.vehiclePlan[0].perHourFee)*firstTimeOfferPercentage)
            rideAmount = Math.round(rideAmount-offerAmount)
          }
  
          // Start transaction
          trans = await db.transaction();
  
          // Get active protection plan
          const activePlan = await ProtectionPlan.findOne({
            where: {
              endDate: null,
              deleted: false,
              startDate: {
                [Op.lte]: startDateTime
              }
            }
          });

          if (!activePlan) {
            throw new CustomError('No active protection plan found', 400);
          }

          const hours = getHoursDifference(startDateTime, endDateTime);
          const extraHours = Math.max(0, hours - 12);

          const isLuxury = vehicleInfo?.isLuxury || false;

          const protectionPlans = [
            {
              type: 'basicPlan',
              name: 'Basic Plan',
              amount: isLuxury ? 
                (activePlan.basicPlanLuxuryPrice + (extraHours * activePlan.basicPlanLuxuryExtraHourPrice)) :
                (activePlan.basicPlanPrice + (extraHours * activePlan.basicPlanExtraHourPrice)),
              accidentAmount: isLuxury ? activePlan.basicPlanLuxuryAccidentAmount : activePlan.basicPlanAccidentAmount,
              required: false
            },
            {
              type: 'silverPlan', 
              name: 'Silver Plan',
              amount: isLuxury ?
                (activePlan.silverPlanLuxuryPrice + (extraHours * activePlan.silverPlanLuxuryExtraHourPrice)) :
                (activePlan.silverPlanPrice + (extraHours * activePlan.silverPlanExtraHourPrice)),
              accidentAmount: isLuxury ? activePlan.silverPlanLuxuryAccidentAmount : activePlan.silverPlanAccidentAmount,
              required: false
            },
            {
              type: 'goldPlan',
              name: 'Gold Plan', 
              amount: isLuxury ?
                (activePlan.goldPlanLuxuryPrice + (extraHours * activePlan.goldPlanLuxuryExtraHourPrice)) :
                (activePlan.goldPlanPrice + (extraHours * activePlan.goldPlanExtraHourPrice)),
              accidentAmount: isLuxury ? activePlan.goldPlanLuxuryAccidentAmount : activePlan.goldPlanAccidentAmount,
              required: false
            }
          ];
          
          let convenience_fee = findItemByType(settings,CONVENIENCE_FEE)?.value ? findItemByType(settings,CONVENIENCE_FEE).value : 0;
          let driver_fee = findItemByType(settings,DRIVER_FEE)?.value ? findItemByType(settings,DRIVER_FEE)?.value : 0; 
          // let deposit_amount = findItemByType(settings,DEPOSIT_AMOUNT)?.value ? findItemByType(settings,DEPOSIT_AMOUNT)?.value : 0;
          let max_wallet_points = findItemByType(settings,MAX_POINTS_USAGE)?.value ? findItemByType(settings,MAX_POINTS_USAGE)?.value : 100;

          await trans.commit();
          return {
            driverFee: {type:'driverFee', refundable:false, required:false, amount:driver_fee},
            convenienceFee: {type:'convenienceFee', refundable:false, required:false, amount:convenience_fee},
            rideAmount: {type:'rideAmount', refundable:false, required:true, amount:rideAmount, offerAmount:offerAmount, offerPercentage:offerAmount ? '20%' : 0},
            protectionPlans,
            maxWalletPoints: max_wallet_points
          };
        } catch (error) {
          // Rollback trans if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error
      }
  }
  // async function bookingSummary({ userId, vehicleId, startTime, endTime }) {
  //     let trans;
    
  //     try {
  //         let res = {}
  //         if(userId) res = await precheck(userId)
  //         const startDateTime = new Date(startTime * 1000);
  //         const endDateTime = new Date(endTime * 1000);
  
  //         // Check if the slot is free before booking
  //         console.log('startDateTime',startDateTime)
  //         console.log('endDateTime',endDateTime)
  //         console.log('vehicleId',vehicleId)
  //         const isSlotFreeFlag = await isSlotFree(vehicleId, startDateTime, endDateTime);
  //         if (!isSlotFreeFlag) {
  //           throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
  //         }
  
  //         let lastBooking = null; 
  //         if(userId) 
  //           {
  //             lastBooking = await Booking.findOne({
  //               where: {
  //                 userId: userId,
  //                 status: {
  //                   [Sequelize.Op.in]: [BOOKING_BOOKED, BOOKING_FINISHED, BOOKING_ONGOING]
  //                 }
  //               }
  //             });
  //           }
  //         // let vehicleInfo = {};
  //         let vehicleInfo = await getVehicleById(vehicleId,startTime,endTime)
  //         let rideAmount = getHoursDifference(startDateTime,endDateTime)*(res.isPremium ? vehicleInfo.vehiclePlan[0].offerHourFee : vehicleInfo.vehiclePlan[0].perHourFee)
  //         let offerAmount = 0;
  //         let settings = await getAllSettings()
  //         if(userId && !lastBooking && !res.isPremium)
  //         {
  //           const firstTimeOfferPercentage = findItemByType(settings, FIRST_TIME_OFFER)?.value ? parseFloat(findItemByType(settings, FIRST_TIME_OFFER).value) / 100 : 0;
  //           offerAmount = Math.round(getHoursDifference(startDateTime,endDateTime)*(vehicleInfo.vehiclePlan[0].perHourFee)*firstTimeOfferPercentage)
  //           rideAmount = Math.round(rideAmount-offerAmount)
  //         }
  
  //         // Start transaction
  //         trans = await db.transaction();
  
  //         // Commit trans
          
  //         let convenience_fee = findItemByType(settings,CONVENIENCE_FEE)?.value ? findItemByType(settings,CONVENIENCE_FEE).value : 0;
  //         let driver_fee = findItemByType(settings,DRIVER_FEE)?.value ? findItemByType(settings,DRIVER_FEE)?.value : 0; 
  //         // let deposit_amount = findItemByType(settings,DEPOSIT_AMOUNT)?.value ? findItemByType(settings,DEPOSIT_AMOUNT)?.value : 0;
  //         let max_wallet_points = findItemByType(settings,MAX_WALLET_POINTS)?.value ? findItemByType(settings,MAX_WALLET_POINTS)?.value : 100;
  //         let deposit_amount = parseInt(vehicleInfo.deposit);
  //         await trans.commit();
  //         return {driverFee:{type:'driverFee',refundable:false,required:false,amount:driver_fee},convenienceFee:{type:'convenienceFee',refundable:false,required:false,amount:convenience_fee},deposit:{type:'deposit',refundable:true,required:res.isPremium ? false : true,amount:res.isPremium ? 0 : deposit_amount},rideAmount:{type:'rideAmount',refundable:false,required:true,amount:rideAmount,offerAmount:offerAmount,offerPercentage:offerAmount ? '20%' : 0},maxWalletPoints:max_wallet_points};
  //       } catch (error) {
  //         // Rollback trans if anything fails
  //         if (trans) {
  //             await trans.rollback();
  //         }
  //         throw error
  //     }
  // }


  async function rescheduleSummary({ id }) {
    let trans;

    try {
      const booking = await Booking.findOne({
        where: {
          id: id
        },
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            include: [
              {
                model: VehiclePlan,
                as: 'vehiclePlan'
              },
              {model:Brand,as:'brand',attributes:['name']},
            ]
          }
        ]
      });

      if (!booking) {
        throw new CustomError('Booking not found', 400, 'BOOKING_NOT_FOUND');
      }

      // Check if booking is already started
      if (booking.status !== BOOKING_BOOKED) {
        throw new CustomError('Booking is already started or completed', 400, 'INVALID_BOOKING_STATUS');
      }

      // Check if already rescheduled
      if (booking.isRescheduled) {
        throw new CustomError('Booking is already rescheduled once', 400, 'ALREADY_RESCHEDULED');
      }

      // Get reschedule fee from settings
      const settings = await getAllSettings();
      const rescheduleFee = findItemByType(settings,RESCHEDULE_FEE)?.value || 0;

      return {
        ...booking.toJSON(),
        rescheduleFee: parseInt(rescheduleFee)
      };

    } catch (error) {
      if (trans) {
        await trans.rollback();
      }
      throw error;
    }
  }
  async function initiateReschedule({ id, startTime }) {
    let trans;

    try {
      const booking = await Booking.findOne({
        where: {
          id: id
        },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['name', 'contactNumber', 'email']
          },
          {
            model: Vehicle,
            as: 'vehicle',
            include: [
              {
                model: VehiclePlan,
                as: 'vehiclePlan'
              }
            ]
          }
        ]
      });

      if (!booking) {
        throw new CustomError('Booking not found', 400, 'BOOKING_NOT_FOUND');
      }

      // Check if booking is already started
      if (booking.status !== BOOKING_BOOKED) {
        throw new CustomError('Booking is already started or completed', 400, 'INVALID_BOOKING_STATUS');
      }

      // Convert unix timestamp to moment object for new start time
      const startDateTime = moment.unix(startTime);

      // Calculate duration between original start and end time
      const originalDuration = moment(booking.endTime).diff(moment(booking.startTime));

      // Add same duration to new start time to get new end time
      const endDateTime = moment(startDateTime).add(originalDuration);

      // Check if start time is in future
      if (moment(booking.startTime).isBefore(moment())) {
        throw new CustomError('Cannot reschedule past bookings', 400, 'INVALID_BOOKING_TIME');
      }

      // Check if already rescheduled
      if (booking.isRescheduled) {
        throw new CustomError('Booking is already rescheduled once', 400, 'ALREADY_RESCHEDULED');
      }

      // Check if the new slot is available
      const isSlotAvailable = await isSlotFree(booking.vehicleId, startDateTime.toDate(), endDateTime.toDate(),booking.id);
      if (!isSlotAvailable) {
        throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
      }

      // Get reschedule fee from settings
      const settings = await getAllSettings();
      const rescheduleFee = parseInt(findItemByType(settings, RESCHEDULE_FEE)?.value || 0);

      // Start transaction
      trans = await db.transaction();

      // Create payment order
      const orderId = await createPaymentOrder(rescheduleFee * 100);
      const prefills = {
        name: booking.user.name,
        contactNumber: `${booking.user.contactNumber}`,
        email: booking.user.email
      };

      // Create transaction record
      const transactionInfo = await Transaction.create({
        userId: booking.userId,
        amount: rescheduleFee * 100,
        orderId,
        type: TRANSACTION_TYPE_RESCHEDULE,
      }, { trans });

      // Create reschedule record
      const rescheduleInfo = await Reschedule.create({
        userId: booking.userId,
        bookingId: booking.id,
        transactionId: transactionInfo.id,
        rescheduledTo: startDateTime.toDate(),
        rescheduledFrom: moment(booking.startTime).toDate(),
        status: RESCHEDULE_INITIATED
      }, { trans });

      // Commit transaction
      await trans.commit();

      return {
        amount: rescheduleFee * 100,
        rescheduleId:rescheduleInfo.id,
        orderId,
        prefills,
        bookingId: booking.id
      };

    } catch (error) {
      if (trans) {
        await trans.rollback();
      }
      throw error;
    }
  }


  async function confirmReschedule({userId, paymentId, orderId, signature}) 
  {
      let trans;
  
      try {
          trans = await db.transaction();
  
          let tinfo = await Transaction.findOne({where:{orderId:orderId}});
          console.log('values',paymentId,'-',tinfo.orderId)
          console.log('sign',signature)
          // Verify the payment BEFORE trusting it. This used to compute `isValid`
          // and discard it, so any authenticated caller with an orderId could
          // confirm a payment that never happened. See utils/paymentSignature.js.
          assertPaymentSignature('reschedule', { paymentId, orderId: tinfo.orderId, signature });
          if (tinfo) {
            await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,paymentId:paymentId});
          }
              const updatedTransaction = await Reschedule.update({
                  status: RESCHEDULE_DONE,
              }, {
                  where: { transactionId: tinfo.dataValues.id },
                  transaction: trans,
              });
      
              if (!updatedTransaction[0]) {
                  throw new CustomError({message:'Reschedule not found or not updated.',status:'FAILED TO UPDATE'});
              }

              const reschedule = await Reschedule.findOne({ where: { transactionId: tinfo.dataValues.id } });
              const booking = await Booking.findOne({where:{id:reschedule.bookingId}});
              let endTime = moment(reschedule.rescheduledTo).add(booking.duration,'hours').format();
              await booking.update({ startTime: reschedule.rescheduledTo,endTime:endTime,isRescheduled:true },{transaction:trans});

          // Commit transaction
          await trans.commit();
          eventEmitter.emit('bookingRescheduled',{rescheduleId:reschedule.id,bookingId:booking.bookingId,amount:parseInt(tinfo.dataValues.amount)/100})
          return updatedTransaction // Return the transactionId for further processing if needed
      } catch (error) {
          // Rollback transaction if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error.message;
      }
  };
  
  async function extentionSummary({ userId, bookingId, hoursToExtend }) {
    let trans;

    try {
      
      let res;
      if(userId) res = await precheck(userId)
      const booking = await Booking.findOne({where:{bookingId:bookingId}});
      const endDateTime = moment.utc(booking.endTime).add(hoursToExtend, 'hours').format();
        // Check if the slot is free before booking
        console.log('booking.endTime', booking.endTime)
        console.log('endDateTime', endDateTime)
        console.log('booking.vehicleId', booking.vehicleId)
        const isSlotAvailable = await isExtensionSlotFree(booking.vehicleId, booking.id,booking.endTime, endDateTime);
        if (!isSlotAvailable) {
          throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
        }

        // Get vehicle details and plan
        const vehicle = await Vehicle.findByPk(booking.vehicleId);
        const vehiclePlan = await VehiclePlan.findOne({
            where: {
                vehicleId: booking.vehicleId,
                startTime: { [Op.lte]: new Date() }, // Optionally, you can filter plans that have already started
            },
            order: [['startTime', 'DESC']],
            limit: 1,
        });

        const endTimeUnix = convertToUnixTimestamp(booking.endTime);
        const endDateTimeMoment = moment.utc(endDateTime);
        const endTimeMoment = moment.utc(booking.endTime);

        const hoursBooked = Math.ceil(endDateTimeMoment.diff(endTimeMoment, 'hours', true));
        const totalAmount = vehiclePlan.perHourFee * hoursBooked;

        // Start transaction
        trans = await db.transaction();

        // Commit trans
        await trans.commit();

        return {isAvailable: true, totalAmount: totalAmount};
    } catch (error) {
        // Rollback trans if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error
    }
}


  async function initiateExtensionBooking({ userId, bookingId, hoursToExtend }) {
      let trans;
  
      try {
          let res = await precheck(userId)
          let bookingInfo = await Booking.findOne({where:{bookingId:bookingId}});
          if(bookingInfo.status !== BOOKING_ONGOING) throw CustomError('Ride can be extended only when its ongoing.', 400, 'CANNOT_EXTEND_RIDE')
          // const startDateTime = new Date(startTime * 1000);
          const endDateTime = moment(bookingInfo.endTime).add(hoursToExtend, 'hours').format();
  
          // Check if the slot is free before booking
          const isSlotAvailable = await isExtensionSlotFree(bookingInfo.vehicleId,bookingInfo.id, bookingInfo.endTime, endDateTime);
          if (!isSlotAvailable) {
            throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
          }
  
          // Get user details
          const user = await User.findByPk(userId);
          if (!user) {
              throw new CustomError('The user is not found.', 400, 'USER_NOT_FOUND');
          }
  
          // Get vehicle details and plan
          const vehicle = await Vehicle.findByPk(bookingInfo.vehicleId);
          const vehiclePlan = await VehiclePlan.findOne({
              where: {
                  vehicleId:bookingInfo.vehicleId,
                  startTime: { [Op.lte]: new Date() }, // Optionally, you can filter plans that have already started
              },
              order: [['startTime', 'DESC']],
              limit: 1,
          });

          const endTimeUnix = convertToUnixTimestamp(bookingInfo.endTime);
          const endDateTimeMoment = moment(endDateTime);
          const endTimeMoment = moment(bookingInfo.endTime);
  
          const hoursBooked = Math.ceil(endDateTimeMoment.diff(endTimeMoment, 'hours', true));
          const totalAmount = vehiclePlan.perHourFee * hoursBooked;
          
          // Start transaction
          trans = await db.transaction();
          
          // Create payment order
          const orderId = await createPaymentOrder(totalAmount*100)
          const prefills = {name:user.name,contactNumber:`${user.contactNumber}`,email:user.email}
          const transactionInfo = await Transaction.create({
              userId,
              amount: totalAmount*100,
              orderId,
              type:TRANSACTION_TYPE_EXTENSION,
          }, { trans });
  
          // Create a new booking
          const extensionInfo = await Extension.create({
              userId,
              bookingId: bookingInfo.id,
              transactionId: transactionInfo.id, // Assign payment order ID to transId
              existingEndTime:bookingInfo.endTime,
              extendedEndTime: endDateTime,
              extendedHours:hoursBooked,
              totalAmount,
              status:EXTENSION_INITIATED
          }, { trans,returning:true });
  
          // Commit trans
          await trans.commit();
  
          return {amount:totalAmount*100,orderId,prefills,bookingId:bookingInfo.id};
      } catch (error) {
        console.log(error)
          // Rollback trans if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error
      }
  }

  async function initiateBooking({ userId, vehicleId, startTime, endTime, lat, lng,cityId, address, deliveryType, offerId,walletPointsUsed,protectionPlan }) {
    let trans = await db.transaction();
    console.log(vehicleId, userId, startTime, endTime, lat, lng, address, deliveryType);

    try {
      if (deliveryType !== 'self' && deliveryType !== 'driver') throw new CustomError('Invalid Delivery Type', 400, 'INVALID_DELIVERY_TYPE');
      if (protectionPlan !== 'basicPlan' && protectionPlan !== 'silverPlan' && protectionPlan !== 'goldPlan') throw new CustomError('Invalid Protection Plan', 400, 'INVALID_PROTECTION_PLAN');
      let res = await precheck(userId);

      // `verificationStatus` is the single gate on booking: only an ACTIVE
      // profile — one an admin has approved — may book. This replaced a set of
      // per-document checks that could disagree with the profile status (a
      // user whose documents were each verified but whose profile was never
      // approved could book, and a user whose profile was rejected could too
      // as long as the old flags were still set).
      const status = res.user.verificationStatus;
      if (status !== 'active') {
        if (status === 'suspended') throw new CustomError('Your account has been suspended.', 403, 'ACCOUNT_SUSPENDED');
        if (status === 'pending') throw new CustomError('Your profile is under verification. You can book once it is approved.', 400, 'VERIFICATION_PENDING');
        if (status === 'rejected') throw new CustomError('Your verification was rejected. Please update your details and resubmit.', 400, 'VERIFICATION_REJECTED');
        throw new CustomError('Complete your profile and verification before booking.', 400, 'PROFILE_NOT_COMPLETED');
      }
      if (!startTime || !endTime) throw new CustomError('Invalid Start time / End time.', 400, 'INVALID_DATETIME');
      if (res.isPaymentDue) throw new CustomError('Clear the payment due before booking.', 400, 'PAYMENT_DUE');

      const bookingInfo = await Booking.findOne({
        where: {
          userId: userId,
          [Op.or]: [
            { status: BOOKING_BOOKED },
            { status: BOOKING_ONGOING }
          ],
          startTime: {
            [Op.lte]: new Date(endTime * 1000)
          },
          endTime: {
            [Op.gte]: new Date(startTime * 1000)
          }
        }
      });

      if (bookingInfo) {
        throw new CustomError('Only one booking can be made at a time', 400, 'MULTIPLE_BOOKING');
      }

      if(!lat || !lng)
      {
        const city = await City.findByPk(cityId);
        if(!city) {
          throw new CustomError('City not found', 400, 'CITY_NOT_FOUND');
        }
        lat = city.lat;
        lng = city.lng;
      }

      const startDateTime = new Date(startTime * 1000);
      const endDateTime = new Date(endTime * 1000);

      // Check if the slot is free before booking
      const isSlotAvailable = await isSlotFree(vehicleId, startDateTime, endDateTime);
      if (!isSlotAvailable) {
        throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
      }

      // Get user details
      const user = await User.findByPk(userId);
      if (!user) {
        throw new CustomError('User Not Found', 400, 'USER_NOT_FOUND');
      }

      // Get vehicle details and plan
      const vehicle = await Vehicle.findByPk(vehicleId);

      if (!vehicle.active) {
        throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
      }

      const vehiclePlan = await VehiclePlan.findOne({
        where: {
          vehicleId,
          startTime: { [Op.lte]: new Date() }, // Optionally, you can filter plans that have already started
        },
        order: [['startTime', 'DESC']],
        limit: 1,
        raw: true
      });
      if (!vehiclePlan) {
        throw new Error('Vehicle plan not found.');
      }

      let membershipOffer = 0;

      const membershipInfo = await getMembershipInfo();
      membershipOffer = membershipInfo.membershipRideOffer;

      let settings = await getAllSettings();
      let firstTimeOfferPercentage = findItemByType(settings, FIRST_TIME_OFFER)?.value ? parseFloat(findItemByType(settings, FIRST_TIME_OFFER).value) / 100 : 0;
      let totalAmount = 0;
      let depositAmount = 0;
      let protectionPlanFee = 0;
      let convenienceFee = parseInt(findItemByType(settings, CONVENIENCE_FEE).value);
      let driverFee = 0;
      if (deliveryType === 'driver') driverFee = parseInt(findItemByType(settings, DRIVER_FEE).value);
      totalAmount += convenienceFee;
      totalAmount += driverFee;

      let lastBooking = null;
      if (userId) {
        lastBooking = await Booking.findOne({
          where: {
            userId: userId,
            status: {
              [Sequelize.Op.in]: [BOOKING_BOOKED, BOOKING_FINISHED, BOOKING_ONGOING]
            }
          }
        });
      }

      let nonMemberRideAmount = getHoursDifference(startDateTime, endDateTime) * (vehiclePlan.perHourFee);
      let offerAmount = 0;
      let bookingWalletPoints = 0;

      const hoursBooked = Math.ceil((endDateTime - startDateTime) / (60 * 60 * 1000)); // Convert milliseconds to hours
      if (res.isPremium) {
        let membershipInfo = await getMembershipInfo();
        const discountedFee = vehiclePlan.perHourFee * (1 - membershipOffer / 100);
        totalAmount += discountedFee * hoursBooked;
      } else {
        if (!res.isFreeDepositAllowed) {
          // depositAmount = parseInt(vehicle.deposit);
          totalAmount = totalAmount + depositAmount;
        }
        if (userId && !lastBooking) {
          offerAmount = Math.round(getHoursDifference(startDateTime, endDateTime) * (vehiclePlan.perHourFee) * firstTimeOfferPercentage);
          nonMemberRideAmount = Math.round(nonMemberRideAmount - offerAmount);
          totalAmount += nonMemberRideAmount;
        } else totalAmount += vehiclePlan.perHourFee * hoursBooked;
      }

      // Get protection plan fee if plan is selected
      let activeProtectionPlan;
      if (protectionPlan) {
        const activePlan = await ProtectionPlan.findOne({
          where: {
            startDate: {
              [Op.lte]: startDateTime
            },
            [Op.or]: [
              { endDate: null },
              { endDate: { [Op.gte]: startDateTime } }
            ],
            deleted: false
          }
        });

        if (!activePlan) {
          throw new CustomError('No active protection plan found', 400);
        }

        const hours = getHoursDifference(startDateTime, endDateTime);
        const extraHours = Math.max(0, hours - 12);

        switch(protectionPlan) {
          case 'basicPlan':
            protectionPlanFee = activePlan.basicPlanPrice + (extraHours * activePlan.basicPlanExtraHourPrice);
            break;
          case 'silverPlan':
            protectionPlanFee = activePlan.silverPlanPrice + (extraHours * activePlan.silverPlanExtraHourPrice);
            break;
          case 'goldPlan':
            protectionPlanFee = activePlan.goldPlanPrice + (extraHours * activePlan.goldPlanExtraHourPrice);
            break;
        }

        totalAmount += protectionPlanFee;
        activeProtectionPlan = activePlan;
      }

      // Apply offer if offerId is provided
      let appliedOffer = null;
      if (offerId) {
        const offer = await getOfferById(offerId);
        if (offer) {
          if (offer.discount_type === 'percent') {
            offerAmount = (nonMemberRideAmount * offer.discount_value) / 100;
          } else if (offer.discount_type === 'flat') {
            offerAmount = offer.discount_value;
          }
          nonMemberRideAmount -= offerAmount;
          totalAmount -= offerAmount;
          // The OfferUsage row is written AFTER the booking exists — see below.
          // It used to be created here, referencing `bookingUniqueId` some 26
          // lines before that variable is declared, which threw a TDZ
          // ReferenceError on every booking that applied an offer.
          appliedOffer = offer;
        }
      }

      if(!isNaN(walletPointsUsed) && walletPointsUsed>0)
      {
        let walletPoints = await Wallet.findOne({where:{userId:userId}})
        if(walletPoints.points >= walletPointsUsed)
        {
          let walletPoints = await Wallet.update({points:walletPoints.points-walletPointsUsed},{where:{userId:userId},transaction:trans})
          totalAmount -= walletPointsUsed;
          bookingWalletPoints = walletPointsUsed
        }
      }

      // Create payment order
      const orderId = await createPaymentOrder(totalAmount * 100);
      const prefills = { name: user.name, contactNumber: `${user.contactNumber}`, email: user.email };
      const transactionInfo = await Transaction.create({
        userId,
        amount: totalAmount * 100,
        orderId,
        type: TRANSACTION_TYPE_BOOKING,
      }, { trans });

      let bookingUniqueId = uniqid.time();
      // Create a new booking
      const booking = await Booking.create({
        userId,
        bookingId: bookingUniqueId,
        vehicleId,
        startTime: startDateTime,
        endTime: endDateTime,
        deliveryFee: driverFee,
        deliveryType: deliveryType,
        convenienceFee: convenienceFee,
        kmAlloted: vehiclePlan.kmAlloted * hoursBooked,
        extraKmFee: vehiclePlan.extraKmFee,
        depositAmount: depositAmount,
        totalAmount,
        WalletPointsAwarded:100,
        walletPointsUsed: bookingWalletPoints,
        protectionPlanFee: protectionPlanFee,
        protectionPlan: activeProtectionPlan.id,
        protectionPlanTier: protectionPlan || null,
        address: address,
        lat: lat,
        lng: lng,
        transactionId: transactionInfo.id, // Assign payment order ID to transId
        offerAmount: offerAmount // Update offerAmount in the booking model
      }, { trans, returning: true });

      // Offer usage is recorded here, not where the discount is calculated,
      // because it needs the booking that now exists. Keys are camelCase to
      // match the model — the previous snake_case ones were silently dropped
      // by Sequelize, which would have written nulls into NOT NULL columns.
      if (appliedOffer) {
        await OfferUsage.create({
          offerId: appliedOffer.id,
          userId,
          bookingId: booking.id,
          offerAmount,
        }, { transaction: trans });
      }

      // Commit trans
      await trans.commit();

      return { amount: totalAmount * 100, orderId, prefills, bookingId: bookingUniqueId };
    } catch (error) {
      console.log(error);
      // Rollback trans if anything fails
      if (trans) {
        await trans.rollback();
      }
      throw error;
    }
  }



  async function adminCreateRide({ userId=null, vehicleId, startTime, endTime,lat,lng,address,bookingType }) 
  {
    let trans = await db.transaction();;

    try {

      if(!startTime || !endTime) throw new CustomError('Invalid Start time / End time.', 400, 'INVALID_DATETIME');
      

      if(bookingType === 'offline')
        {

          const startDateTime = new Date(startTime);
      const endDateTime = new Date(endTime);
      
        // Check if the slot is free before booking
        const isSlotAvailable = await isSlotFree(vehicleId, startDateTime, endDateTime);
        if (!isSlotAvailable) {
          throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
        }
        
        // Get vehicle details and plan
        const vehicle = await Vehicle.findByPk(vehicleId);
        
        if (!vehicle.active) {
          throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
        }

        let bookingUniqueId = uniqid.time();

          const booking = await Booking.create({
            userId:null,
            bookingId: bookingUniqueId,
            vehicleId,
            startTime: startDateTime,
            endTime: endDateTime,
            deliveryFee:0,
            convenienceFee:0,
            kmAlloted: 0,
            extraKmFee: 0,
            depositAmount:0,
            totalAmount:0,
            address:address ? address : '',
            lat:lat,
            lng:lng,
            bookingType:'offline',
            adminAdded:true,
            paymentType:'cash',
            status:BOOKING_BOOKED,
            transactionId: null, // Assign payment order ID to transId
        }, { trans,returning:true });
        return booking;
        }
        else
        {
      // const bookingInfo = await Booking.findOne({
      //   where: {
      //     userId: userId,
      //     [Op.or]: [
      //       { status: BOOKING_BOOKED },
      //       { status: BOOKING_ONGOING }
      //     ],
      //     startTime: {
      //       [Op.lte]: new Date(endTime*1000)
      //     },
      //     endTime: {
      //       [Op.gte]: new Date(startTime * 1000)
      //     }
      //   }
      // });
      
      // if (bookingInfo) {
      //   throw new CustomError('Only one bookin can be made at a times',400,'MULTIPLE_BOOKING');
      // }
      
      const startDateTime = new Date(startTime * 1000);
      const endDateTime = new Date(endTime * 1000);
      
        // Check if the slot is free before booking
        const isSlotAvailable = await isSlotFree(vehicleId, startDateTime, endDateTime);
        if (!isSlotAvailable) {
          throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
        }

        // Get user details
        const user = await User.findByPk(userId);
        if (!user) {
            throw new CustomError('User Not Found', 400, 'USER_NOT_FOUND');
        }
        
        // Get vehicle details and plan
        const vehicle = await Vehicle.findByPk(vehicleId);
        
        if (!vehicle.active) {
          throw new CustomError('The selected slot is not available for booking.', 400, 'SLOT_NOT_AVAILABLE');
        }

        const vehiclePlan = await VehiclePlan.findOne({
            where: {
                vehicleId,
                startTime: { [Op.lte]: new Date() }, // Optionally, you can filter plans that have already started
            },
            order: [['startTime', 'DESC']],
            limit: 1,
            raw:true
        });
        if (!vehiclePlan) {
            throw new Error('Vehicle plan not found.');
        }

            let res = await precheck(userId)
            let membershipOffer = 0;
  
            // if (userIsPremium) {
              const membershipInfo = await getMembershipInfo();
              membershipOffer = membershipInfo.membershipRideOffer;
              
              let settings = await getAllSettings()
              let totalAmount=0;
              let depositAmount = 0;
              let convenienceFee = parseInt(findItemByType(settings,CONVENIENCE_FEE).value);
              let driverFee = parseInt(findItemByType(settings,DRIVER_FEE).value);
              totalAmount += convenienceFee;
              totalAmount += driverFee;

              let lastBooking = null; 
              if(userId)
                {
                  await Booking.findOne({
                    where: {
                      userId: userId,
                      status: {
                        [Sequelize.Op.in]: [BOOKING_BOOKED, BOOKING_FINISHED, BOOKING_ONGOING]
                      }
                    }
                  });
                }
              // let vehicleInfo = {};
              let vehicleInfo = await getVehicleById(vehicleId,startTime,endTime)
              let nonMemberRideAmount = getHoursDifference(startDateTime,endDateTime)*(vehiclePlan.perHourFee)
              let offerAmount = 0;
              
              const hoursBooked = Math.ceil((endDateTime - startDateTime) / (60 * 60 * 1000)); // Convert milliseconds to hours
            if(res.isPremium)
            {
              let membershipInfo = await getMembershipInfo()
              const discountedFee = vehiclePlan.perHourFee * (1 - membershipOffer / 100);
              totalAmount += discountedFee * hoursBooked;
            }
            else
            {
              if(!res.isFreeDepositAllowed)
              {
                depositAmount = parseInt(findItemByType(settings,DEPOSIT_AMOUNT).value);
                totalAmount = totalAmount + depositAmount;
              } 
              if(userId && !lastBooking)
                {
                  offerAmount = Math.round(getHoursDifference(startDateTime,endDateTime)*(vehiclePlan.perHourFee)*0.2)
                  nonMemberRideAmount = Math.round(nonMemberRideAmount-offerAmount)
                  totalAmount +=nonMemberRideAmount;
                }
              else totalAmount += vehiclePlan.perHourFee * hoursBooked;
            }

            // Create payment order
            const orderId = await createPaymentOrder(totalAmount*100)
            const prefills = {name:user.name,contactNumber:`${user.contactNumber}`,email:user.email}
            const transactionInfo = await Transaction.create({
                userId,
                amount: totalAmount*100,
                orderId,
                type:TRANSACTION_TYPE_BOOKING,
            }, { trans });

            let bookingUniqueId = uniqid.time();
            // Create a new booking
            const booking = await Booking.create({
                userId,
                bookingId: bookingUniqueId,
                vehicleId,
                startTime: startDateTime,
                endTime: endDateTime,
                deliveryFee:driverFee,
                convenienceFee:convenienceFee,
                kmAlloted: vehiclePlan.kmAlloted*hoursBooked,
                extraKmFee: vehiclePlan.extraKmFee,
                depositAmount:depositAmount,
                totalAmount,
                address:address,
                lat:lat,
                lng:lng,
                transactionId: transactionInfo.id, // Assign payment order ID to transId
            }, { trans,returning:true });

            // Commit trans
            await trans.commit();

            return {amount:totalAmount*100,orderId,prefills,bookingId:bookingUniqueId};
          }
    } catch (error) {
      console.log(error)
        // Rollback trans if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error
    }
}
  


  function calculateRefundSummary(startTime, amount, deposit, protectionPlan, protectionPlanFee) {
    // Calculate the time difference between current time and start time
    const timeDifference = Math.abs(new Date() - new Date(startTime)) / (1000 * 60 * 60); // Difference in hours

    // Calculate the cut-off time (12 hours before start time)
    const cutOffTime = new Date(new Date(startTime) - 24 * 60 * 60 * 1000); 
    const finalCutOffTime = new Date(new Date(startTime) - 12 * 60 * 60 * 1000); 
  
    // Initialize summary objects
    const summarySecond = {
      current: false, // Flag indicating this summary is based on current time
      refundAmount: 0, // Default refund amount
      deposit: deposit // Deposit amount remains constant
    };
    const summaryBefore = {
      current: true, // Flag indicating this summary is based on current time
      refundAmount: 0, // Default refund amount
      deposit: deposit // Deposit amount remains constant
    };
    const summaryFinal = {
      current: false, // Flag indicating this summary is based on future time
      refundAmount: 0, // Default refund amount
      deposit: deposit // Deposit amount remains constant
    };
  
    // Calculate refund amount based on time difference
    // Subtract protectionPlanFee from amount since it's non-refundable
    const refundableAmount = amount - protectionPlanFee;
    
    summaryBefore.refundAmount = refundableAmount + deposit; // Full refund of refundable amount + deposit
    summarySecond.refundAmount = (refundableAmount) * 0.5; // 50% refund of refundable amount
    summaryFinal.refundAmount = deposit; // Only deposit refunded
  
    // Construct summary objects
    const summary = {
      current: timeDifference > 24 ? 'before' : timeDifference > 24 ? 'second' : 'final',
      cutOffTime, // If time difference is less than 12 hours, current summary
      finalCutOffTime,
      beforeCutoff: summaryBefore,
      secondCutoff: summarySecond,
      finalCutoff: summaryFinal,
    };
  
    return summary;
  }

  async function createReview({cleanliness,host,comfort,comment,userId,bookingId}) 
  {
      try {
          let bookingInfo = await Booking.findOne({where:{bookingId:bookingId}})
          if (!bookingInfo) {
              throw new CustomError('Invalid Booking Id',400,'INVALID_BOOKING_ID');
          }
          
          if (bookingInfo.status !== BOOKING_FINISHED) {
              throw new CustomError('Cannot Update Review Now',400,'INVALID_BOOKING_STATUS');
          }
          let reviewInfo = await Review.findOne({where:{bookingId:bookingInfo.id},plain:true});
          if (reviewInfo) {
              throw new CustomError('Review already updated',400,'REVIEW_ALREADY_UPDATED');
          }

          // Create the review
          let review = await Review.create({
              userId,
              bookingId: bookingInfo.id,
              cleanlinessRating: parseInt(cleanliness),
              comfortRating: parseInt(comfort), 
              hostRating: parseInt(host),
              comment: comment,
              vehicleId: bookingInfo.vehicleId
          });

          // Get vehicle and update its rating
          let vehicle = await Vehicle.findOne({where: {id: bookingInfo.vehicleId}});
          if(vehicle) {
              // Calculate new average ratings
              const totalReviews = vehicle.reviews + 1;
              const currentRating = vehicle.rating * vehicle.reviews; // Get total of all previous ratings
              
              // Add new ratings and calculate average
              const newRating = (currentRating + (parseInt(cleanliness) + parseInt(comfort) + parseInt(host))/3) / totalReviews;

              // Update vehicle with new rating and review count
              await vehicle.update({
                  rating: parseFloat(newRating.toFixed(1)),
                  reviews: totalReviews
              });
          }

          return review;
      } catch (error) {
          throw error
      }
  };

  async function refundSummary(bookingId) 
  {
      try {
  
          let bookingInfo = await Booking.findOne({where:{bookingId:bookingId},plain:true});
          
          if (!bookingInfo) {
              throw new CustomError('Booking not found',400,'BOOKING_NOT_FOUND');
          }

          let refundSummmary = await calculateRefundSummary(bookingInfo.startTime,(bookingInfo.totalAmount-(bookingInfo.depositAmount+bookingInfo.convenienceFee)),bookingInfo.depositAmount,bookingInfo.protectionPlan,bookingInfo.protectionPlanFee)
      

  
          return refundSummmary; // Return the transactionId for further processing if needed
      } catch (error) {
 
          throw error;
      }
  };

  async function confirmExtension({userId, paymentId, orderId, signature}) 
  {
      let trans;
  
      try {
          trans = await db.transaction();
  
          let tinfo = await Transaction.findOne({where:{orderId:orderId}});
          console.log('values',paymentId,'-',tinfo.orderId)
          console.log('sign',signature)
          // Verify the payment BEFORE trusting it. This used to compute `isValid`
          // and discard it, so any authenticated caller with an orderId could
          // confirm a payment that never happened. See utils/paymentSignature.js.
          assertPaymentSignature('extension', { paymentId, orderId: tinfo.orderId, signature });
          if (tinfo) {
            await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,paymentId:paymentId});
          }
              const updatedTransaction = await Extension.update({
                  status: EXTENSION_DONE,
              }, {
                  where: { transactionId: tinfo.dataValues.id },
                  transaction: trans,
              });
      
              if (!updatedTransaction[0]) {
                  throw new CustomError({message:'Extension not found or not updated.',status:'FAILED TO UPDATE'});
              }

              const extension = await Extension.findOne({ where: { transactionId: tinfo.dataValues.id } });
              const booking = await Booking.findOne({where:{id:extension.bookingId}});
              await booking.update({ endTime: extension.extendedEndTime },{transaction:trans});

          // Commit transaction
          await trans.commit();
          eventEmitter.emit('bookingExtended',{extensionId:extension.id,bookingId:booking.bookingId,amount:parseInt(tinfo.dataValues.amount)/100})
          return updatedTransaction // Return the transactionId for further processing if needed
      } catch (error) {
          // Rollback transaction if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error.message;
      }
  };

  async function confirmBooking({userId, paymentId, orderId, signature}) 
  {
      let trans;
  
      try {
        console.log('confirm booking',userId, paymentId, orderId, signature)
        // const userInfo = await User.findOne({where:{id:userId},plain:true});
          trans = await db.transaction();
  
          let tinfo = await Transaction.findOne({where:{orderId:orderId}});

          // Verify the payment BEFORE trusting it. This used to compute `isValid`
          // and discard it, so any authenticated caller with an orderId could
          // confirm a payment that never happened. See utils/paymentSignature.js.
          assertPaymentSignature('booking', { paymentId, orderId: tinfo.orderId, signature });
          if (tinfo) {
            await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,paymentId:paymentId});
          }
              const updatedBooking = await Booking.update({
                  status: BOOKING_BOOKED,
                  // Only the START otp is issued here. The END otp is issued
                  // when the ride actually starts — see rideOtpService.
                  ...rideOtp.issueStartOtp(),
              }, {
                  where: { transactionId: tinfo.dataValues.id },
                  transaction: trans
              });
      
              if (!updatedBooking[0]) {
                  throw new CustomError({message:'Booking not found or not updated.',status:'FAILED TO UPDATE'});
              }

              let bookingInfo = await Booking.findOne({where:{transactionId:tinfo.dataValues.id}});

              // Fetch the vehicle information to get the hostId
              const vehicleInfo = await Vehicle.findOne({where: {id: bookingInfo.vehicleId}});

              if(bookingInfo.WalletPointsAwarded > 0)
              {
                let wallet = await Wallet.findOne({where:{userId:bookingInfo.userId}});
                wallet.walletPoints -= bookingInfo.WalletPointsAwarded;
                await wallet.save({transaction:trans});

                await WalletTransaction.create({
                  userId: bookingInfo.userId,
                  walletId: wallet.id,
                  points: bookingInfo.WalletPointsAwarded,
                  isCredit: false,
                  description: `Points deducted for booking #${bookingInfo.bookingId}`
                }, {transaction: trans});
              }
              
              // // Check if the booking vehicle belongs to a host
              // if (vehicleInfo && vehicleInfo.hostId) {
              //     // Create a conversation for the booking id between the host and the user
              //     await Conversation.create({
              //         bookingId: bookingInfo.id,
              //         hostId: vehicleInfo.hostId,
              //         userId: userId
              //     });
              // }

              // Commit transaction
              await trans.commit();
              // await sendBookingEmail()
              eventEmitter.emit('bookingConfirmed',{bookingId:bookingInfo.bookingId,hostId:vehicleInfo.hostId,vehicleId:vehicleInfo.id,userId:userId})
  
          return updatedBooking // Return the transactionId for further processing if needed
      } catch (error) {
        console.log('confirmation error',JSON.stringify(error))
        console.log('confirmation error',error.message)
          // Rollback transaction if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error.message;
      }
  };


  // async function startRide({bookingId,startKms,startFuel,pickupTime,startImage}) 
  // {
  //     let trans;
  //     try {
  //         trans = await db.transaction();
  //         let updatedBooking;
  //         let binfo = await Booking.findOne({where:{bookingId:bookingId},plain:true});
  //         if (binfo) {
  //           if(binfo.status === BOOKING_CANCELLED) throw new CustomError('Booking Already Cancelled',400,'FAILED_TO_START');
  //           if(binfo.status === BOOKING_ONGOING) throw new CustomError('Ride Already Started',400,'FAILED_TO_START');
  //           if(binfo.status !== BOOKING_BOOKED) throw new CustomError('Ride Cannot be started',400,'FAILED_TO_START');
  //         //   await binfo.update({status: BOOKING_ONGOING});
  //         // }
  //             updatedBooking = await Booking.update({
  //                 status: BOOKING_ONGOING,
  //                 pickupTime:new Date(pickupTime),
  //                 startKms:parseInt(startKms),
  //                 startFuel:parseInt(startFuel),
  //                 startImage:startImage
  //             }, {
  //                 where: { bookingId: binfo.bookingId},
  //                 transaction: trans,
  //                 returning:true
  //             });
              

  //             if(binfo.WalletPointsAwarded > 0)
  //             {
  //               let wallet = await Wallet.findOne({where:{userId:binfo.userId}});
  //               await WalletTransaction.create({
  //                 userId:binfo.userId,
  //                 walletId:wallet.id,
  //                 points:binfo.WalletPointsAwarded,
  //                 description:`Wallet Points Awarded for booking #${binfo.bookingId}`,
  //                 isCredit:true
  //               },{transaction:trans});
  //               wallet.walletPoints += binfo.WalletPointsAwarded;
  //               await wallet.save({transaction:trans});
  //             }

  //             // Commit transaction
  //             await trans.commit();
  //             eventEmitter.emit('bookingStarted',{bookingId:binfo.bookingId});
      
  //             return updatedBooking // Return the transactionId for further processing if needed
  //           }
  //           else
  //           {
  //                 throw new CustomError({message:'Booking not found',status:'FAILED TO START'});
  //             }

  //     } catch (error) {
  //       console.log(error)
  //         // Rollback transaction if anything fails
  //         if (trans) {
  //             await trans.rollback();
  //         }
  //         throw error;
  //     }
  // };

  

  const startRide = async (bookingId,data) => {
    const transaction = await db.transaction();
    try {
      const booking = await Booking.findByPk(bookingId, { transaction });
      if (!booking) {
        throw new CustomError('Booking not found', 404);
      }
  
      if(booking.status !== BOOKING_BOOKED){
        throw new CustomError('Booking is not booked', 400);
      }
      // When the host has already recorded the handover (startCapturedAt),
      // the rider is only completing the handshake and doesn't have to send
      // readings or photos again.
      const alreadyCaptured = !!booking.startCapturedAt;
      if(!alreadyCaptured && !data.startKms){
        throw new CustomError('Start Kms is required', 400);
      }
      if(!alreadyCaptured && (!data.startImages || data.startImages.length === 0)){
        throw new CustomError('Start Image is required', 400);
      }

      rideOtp.verifyStartOtp(booking, data.startOtp);
      
  
      if(booking.WalletPointsAwarded > 0)
        {
          let wallet = await Wallet.findOne({where:{userId:booking.userId}});
          await WalletTransaction.create({
            userId:booking.userId,
            walletId:wallet.id,
            points:booking.WalletPointsAwarded,
            description:`Wallet Points Awarded for booking #${booking.bookingId}`,
            isCredit:true
          },{transaction:transaction});
          wallet.walletPoints += booking.WalletPointsAwarded;
          await wallet.save({transaction:transaction});
        }
  
  
      // Don't overwrite what the host captured with undefined.
      if (data.startDateTime) booking.pickupTime = new Date(data.startDateTime);
      if (data.startKms !== undefined) booking.startKms = data.startKms;
      if (data.startFuel !== undefined) booking.startFuel = data.startFuel;
      booking.status = BOOKING_ONGOING;
      booking.startOtpVerified = true;
      // The end-of-ride code only comes into existence now, so it can't have
      // been handed over along with the start code.
      Object.assign(booking, rideOtp.issueEndOtp());
      await booking.save({ transaction });
  
      if (data.startImages && data.startImages.length > 0) {
        const allImages = data.startImages.map(image => ({
          url: image.url,
          bookingId: booking.id,
          isCover: false,
          isStartImage: true,
          type: image.type
        }));

        await Image.bulkCreate(allImages, { transaction });
      } else if (!alreadyCaptured) {
        // Only demanded when nobody has captured the handover yet — if the
        // host already uploaded them, the rider is just confirming the OTP.
        throw new CustomError('Images data is required', 400);
      }
  
      await transaction.commit();
  } catch (error) {
      await transaction.rollback();
      throw new CustomError(error.message, 400);
    }
  };


  // async function endRide({bookingId, endKms, endFuel, dropTime, endImage, manualRefund, manualRefundAmount, remarks}) 
  // {
  //     let trans;
  //     try {
  //         trans = await db.transaction();
  //         let updatedBooking;
  //         let binfo = await Booking.findOne({where: {bookingId: bookingId}, include: [{model: Transaction, as: 'transaction'}], plain: true});
  //         if (binfo) {
  //           if (binfo.status === BOOKING_CANCELLED) throw new CustomError('Booking Already Cancelled', 400, 'FAILED_TO_END');
  //           if (binfo.status === BOOKING_BOOKED) throw new CustomError('Ride not started yet', 400, 'FAILED_TO_END');
  //           if (binfo.status !== BOOKING_ONGOING) throw new CustomError('Ride not ongoing', 400, 'FAILED_TO_END');
            
  //           let refundAmount = 0;

  //           if (binfo.depositAmount && binfo.depositAmount > 0) refundAmount += binfo.depositAmount;

  //           if (manualRefund === true || manualRefund === 'true') {
  //             if (manualRefundAmount > 0) {
  //               const refundResponse = await RazorpayInstance.payments.refund(binfo.transaction.paymentId, { amount: manualRefundAmount * 100 });
  
  //               await Refund.create({
  //                 bookingId: binfo.id,
  //                 paymentId: binfo.transaction.paymentId,
  //                 transactionId: binfo.transaction.id,
  //                 acquirer: refundResponse.acquirer_data.arn ? refundResponse.acquirer_data.arn : refundResponse.acquirer_data.rrn ? refundResponse.acquirer_data.rrn : refundResponse.acquirer_data.utr,
  //                 status: REFUND_PENDING,
  //                 amount: manualRefundAmount,
  //                 initiatedTime: new Date()
  //               });
  //             }
  //           } else {
  //             let refundResponse;
  //             if (refundAmount > 0) {
  //               refundResponse = await RazorpayInstance.payments.refund(binfo.transaction.paymentId, { amount: refundAmount * 100 });
  //               await Refund.create({
  //                 bookingId: binfo.id,
  //                 paymentId: binfo.transaction.paymentId,
  //                 transactionId: binfo.transaction.id,
  //                 acquirer: refundResponse.acquirer_data.arn ? refundResponse.acquirer_data.arn : refundResponse.acquirer_data.rrn ? refundResponse.acquirer_data.rrn : refundResponse.acquirer_data.utr,
  //                 status: REFUND_PENDING,
  //                 amount: refundAmount,
  //                 initiatedTime: new Date()
  //               });
  //             }
  //           }

  //           // Calculate points for wallet transaction
  //           const startTime = moment(binfo.startTime);
  //           const endTime = moment(dropTime);
  //           const hoursBooked = Math.ceil(endTime.diff(startTime, 'hours', true));
  //           const points = hoursBooked * 10;

  //           // Find or create wallet and add points
  //           let wallet = await Wallet.findOne({ where: { userId: binfo.userId } });
  //           if (!wallet) {
  //             wallet = await Wallet.create({ userId: binfo.userId, walletPoints: 0 });
  //           }
  //           wallet.walletPoints += points;
  //           await wallet.save();

  //           // Create wallet transaction
  //           await WalletTransaction.create({
  //             userId: binfo.userId,
  //             walletId: wallet.id,
  //             points: points,
  //             description: `Points for the ride #${binfo.bookingId}`,
  //             isCredit: true
  //           });

  //           updatedBooking = await Booking.update({
  //               status: BOOKING_FINISHED,
  //               dropTime: new Date(dropTime),
  //               endKms: parseInt(endKms),
  //               endFuel: parseInt(endFuel),
  //               endImage: endImage,
  //               remarks: remarks,
  //               refundAmount: refundAmount
  //           }, {
  //               where: { bookingId: binfo.bookingId },
  //               transaction: trans,
  //               returning: true
  //           });

  //           await trans.commit();
  //           return await Booking.findOne({ where: { bookingId: bookingId } });
  //         } else {
  //           throw new CustomError({ message: 'Booking not found', status: 'FAILED TO START' });
  //         }
  //     } catch (error) {
  //       console.log(error);
  //       if (trans) {
  //           await trans.rollback();
  //       }
  //       throw error;
  //     }
  // };


  const endRide = async (bookingId, data) => {
    const transaction = await db.transaction();
    try {
      const booking = await Booking.findByPk(bookingId, { transaction });
      if (!booking) {
        throw new CustomError('Booking not found', 404);
      }

      if(booking.status !== BOOKING_ONGOING){
        throw new CustomError('Booking is not ongoing', 400);
      }

      const endAlreadyCaptured = !!booking.endCapturedAt;
      if(!endAlreadyCaptured && !data.endKms){
        throw new CustomError('End Kms is required', 400);
      }

      rideOtp.verifyEndOtp(booking, data.endOtp);

      if (data.endDateTime) booking.dropTime = new Date(data.endDateTime);
      if (data.endKms !== undefined) booking.endKms = data.endKms;
      if (data.endFuel !== undefined) booking.endFuel = data.endFuel;
      booking.status = BOOKING_FINISHED;
      booking.endOtpVerified = true;
      await booking.save({ transaction });
  
      if (data.endImages && data.endImages.length > 0) {
        const allImages = data.endImages.map(image => ({
          url: image.url,
          bookingId: booking.id,
          isCover: false,
          isEndImage: true,
          type: image.type
        }));

        await Image.bulkCreate(allImages, { transaction });
      } else if (!endAlreadyCaptured) {
        throw new CustomError('Images data is required', 400);
      }
  
      const startTime = moment(booking.startTime);
      const endTime = moment(booking.dropTime);
      const hoursBooked = Math.ceil(endTime.diff(startTime, 'hours', true));
      const points = hoursBooked * 10;

      // Find or create wallet and add points
      let wallet = await Wallet.findOne({ where: { userId: booking.userId }, transaction });
      if (!wallet) {
        wallet = await Wallet.create({ userId: booking.userId, walletPoints: 0 }, { transaction });
      }
      wallet.walletPoints += points;
      await wallet.save({ transaction });

      // Create wallet transaction
      await WalletTransaction.create({
        userId: booking.userId,
        walletId: wallet.id,
        points: points,
        description: `Points for the ride #${booking.bookingId}`,
        isCredit: true
      }, { transaction });
  
      await transaction.commit();
      return await Booking.findOne({ where: { bookingId: bookingId } });

    } catch (error) {
      await transaction.rollback();
      throw new CustomError(error.message, 400);
    }
  };


  const userCancelBooking = async (userId,bookingId) => {
    try {
      // Find the booking by ID
      const booking = await Booking.findOne({include:[
        {
          model: Transaction,
          as: 'transaction',
        }],where:{bookingId,userId:userId},plain:true});
      if (!booking) {
        throw new CustomError('Booking not found',404,'FAILED TO UPDATE');
      }
  
      // Check if the booking has already been refunded
      // const existingRefund = await Refund.findOne({ where: { bookingId:booking.id } });
      // if (existingRefund) {
      //   throw new Error('Refund already initiated for this booking');
      // }
      if (booking.status !== BOOKING_BOOKED) {
        throw new CustomError('Cannot Cancel the booking',400,'CANNOT_CANCEL_BOOKING');
      }

      if (booking.status === BOOKING_CANCELLED) {
        throw new CustomError('Already Cancelled',400,'ALREADY_CANCELLED');
      }

      if (booking.isRefunded && booking.refundedAmount >= booking.totalAmount) {
        throw new CustomError('Refund already initiated for this booking',400,'ALREADY_REFUNDED');
      }
  
      // Calculate refund amount based on booking start time
      const startTime = new Date(booking.startTime);
      const currentTime = new Date();
      const timeDifference = (startTime - currentTime) / (1000 * 60 * 60); // Difference in hours

      let refundAmount = 0;
        if (timeDifference > 24) {
          refundAmount = booking.totalAmount - (booking.depositAmount + booking.convenienceFee);
        } else if (timeDifference >= 12) {
          refundAmount = ((booking.totalAmount) - (booking.depositAmount + booking.convenienceFee)) * 0.5
        } else if (timeDifference <= 12) {
          refundAmount = 0; 
        }

        
      // if (timeDifference > 12) {
      //   console.log('timing',timeDifference)
      //   refundAmount = booking.totalAmount - booking.depositAmount;
      // // } else if (timeDifference >= 12) {
      // //   refundAmount = (booking.totalAmount - booking.depositAmount) * 0.5 ;
      // //   await booking.update({ ref });
      // } else {
      //   // If the current time is less than 12 hours from start time, do not initiate refund
      //   // Update booking status to cancelled
      //   // return { message: 'Refund not initiated for bookings within 12 hours of start time', refundAmount };
      // }
      if(!isNaN(booking.depositAmount) && parseInt(booking.depositAmount) > 0) refundAmount+= parseInt(booking.depositAmount);
      // refundAmount+= parseInt(199);
      
      // Create refund request to Razorpay
      if(refundAmount > 0)
        {
          const refundResponse = await RazorpayInstance.payments.refund(booking.transaction.paymentId, { amount: refundAmount });

          await Refund.create({
            bookingId:booking.id,
            paymentId: booking.transaction.paymentId,
            transactionId:booking.transaction.id,
            acquirer:refundResponse.acquirer_data.arn ? refundResponse.acquirer_data.arn : refundResponse.acquirer_data.rrn ? refundResponse.acquirer_data.rrn : refundResponse.acquirer_data.utr,
            status: REFUND_PENDING,
            amount: refundAmount*100,
            initiatedTime: new Date()
          });
        }
  
      // Create a row in the Refund model

      await booking.update({ status: BOOKING_CANCELLED,isRefunded:refundAmount > 0 ? true : false,refundedAmount:refundAmount});
      eventEmitter.emit('bookingCancelled',{bookingId:booking.bookingId})
      return { message: 'Refund initiated successfully', refundAmount };
    } catch (error) {
      console.error('Error initiating refund:', error);
      throw error;
    }
  };


  async function cancelBooking({userId, bookingId}) 
  {
      let trans;
  
      try {
          trans = await db.transaction();
  
          let tinfo = await Booking.findOne({where:{bookingId:bookingId}});
  
          if (tinfo) {
            await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED});
          }
              const updatedBooking = await Booking.update({
                  status: BOOKING_CANCELLED,
              }, {
                  where: { transactionId: tinfo.dataValues.id },
                  transaction: trans,
              });
      
              if (!updatedBooking[0]) {
                  throw new CustomError({message:'Booking not found or not updated.',status:'FAILED TO UPDATE'});
              }

          // Commit transaction
          await trans.commit();
  
          return { message:'Order Paid Webhook Received' }; // Return the transactionId for further processing if needed
      } catch (error) {
          // Rollback transaction if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error;
      }
  };


  async function getAllBookings({userId,startTime,endTime, sort, offset, search,limit,vehicleId,status,cityId}) {
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
          },
          {
            model: User,
            as: 'user',
          },
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
  

  async function getUserBookings(userId) {
    // Fetch all bookings with related information
    const bookings = await Booking.findAll({
      where: { userId },
      include: [
        {
          model: Vehicle,
          as: 'vehicle',
        },
        {
          model: User,
          as: 'user',
        },
      ],
    });

    return bookings;
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
          model: Damage,
          as: 'damages'
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
          as: 'host',
        },
        {
          model: Vehicle,
          as: 'vehicle',
          include:[
            {
              model: Host,
              as: 'host',
              attributes:['id'],
              include:[
                {
                  model: User,
                  as: 'user',
                  attributes:['id','name','email','contactNumber','profilePhoto']
                }
              ]
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
    let review = await Review.findOne({where:{bookingId:booking.id}})
    // console.log('boboking',booking.dataValues.orderId)
    let res = {};
    let refundRes = [];
    // Don't let a payment-gateway lookup failure (e.g. an unknown/mock payment
    // id) 500 the whole ride-detail response — the booking data is still valid.
    if(booking.transaction && booking.transaction.paymentId) {
      try {
        res = await RazorpayInstance.payments.fetch(booking.transaction.paymentId);
      } catch (err) {
        console.error('Razorpay payment fetch failed for', booking.transaction.paymentId, '-', err.message);
      }
    }
    if(booking.refundedAmount > 0)
    {
      try {
        refundRes = await Refund.findAll({where:{bookingId:booking.id},plain:true})
      } catch (err) {
        console.error('Refund lookup failed for booking', booking.id, '-', err.message);
      }
    }

      return {...booking.toJSON(),review:review,payment:res,refunds:refundRes};
    } catch (error) {
      console.log('error',error)
      throw new CustomError(error.message, 400);
    }
  }


  async function isExtensionSlotFree(vehicleId,bookingId, startDateTime, endDateTime) {
    const twoHoursBeforeStart = moment(startDateTime).format();
    const twoHoursAfterEnd = moment(endDateTime).add(2, 'hours').format();
    console.log('twoHoursBeforeStart',twoHoursBeforeStart)
    console.log('twoHoursAfterEnd',twoHoursAfterEnd)
    const overlappingTransaction = await Booking.findOne({
      where: {
          vehicleId,
          id: {
            [Op.ne]: bookingId
          },
          [Op.or]: [
              {
                  status: BOOKING_BOOKED,
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
              {
                  status: BOOKING_ONGOING,
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
          ],
      },
  });

    return !overlappingTransaction;
}

//   async function isSlotFree(vehicleId, startDateTime, endDateTime) {
//     const twoHoursBeforeStart = moment(startDateTime).subtract(2, 'hours');
//     const twoHoursAfterEnd = moment(endDateTime).add(2, 'hours');

//     const overlappingTransaction = await Booking.findOne({
//       where: {
//           vehicleId,
//           [Op.or]: [
//               {
//                   status: BOOKING_BOOKED,
//                   [Op.or]: [
//                       { startTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
//                       { endTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
//                       {
//                           [Op.and]: [
//                               { startTime: { [Op.lte]: twoHoursBeforeStart } },
//                               { endTime: { [Op.gte]: twoHoursAfterEnd } },
//                           ],
//                       },
//                   ],
//               },
//               {
//                   status: BOOKING_ONGOING,
//                   [Op.or]: [
//                       { startTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
//                       { endTime: { [Op.between]: [twoHoursBeforeStart, twoHoursAfterEnd] } },
//                       {
//                           [Op.and]: [
//                               { startTime: { [Op.lte]: twoHoursBeforeStart } },
//                               { endTime: { [Op.gte]: twoHoursAfterEnd } },
//                           ],
//                       },
//                   ],
//               },
//           ],
//       },
//   });

//     return !overlappingTransaction;
// }

module.exports = {initiateBooking,bookingSummary,confirmBooking,getAllBookings,getUserBookings,getBookingById,isSlotFree,startRide,cancelBooking,userCancelBooking,refundSummary,endRide,extentionSummary,initiateExtensionBooking,confirmExtension,createReview,adminCreateRide,getLastBooking,rescheduleSummary,initiateReschedule,confirmReschedule}
