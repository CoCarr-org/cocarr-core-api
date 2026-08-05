const Brand = require('../models/brand');
const Image = require('../models/image');
const Booking = require('../models/booking');
const User = require('../models/user');
const Vehicle = require('../models/vehicle');
const VehiclePlan = require('../models/vehicleplan');
const Transaction = require('../models/transaction');
const {createPaymentOrder} = require('./paymentService');
const { Op } = require('sequelize');
var uniqid = require('uniqid'); 

const db = require('../configs/db');
const { TRANSACTION_TYPE_BOOKING, TRANSACTION_TYPE_MEMBERSHIP, MEMBERSHIP_SUBSCRIBED, TRANSACTION_AUTHORIZED } = require('../configs/constants');
const { precheck } = require('./userService');
const { CustomError } = require('../middlewares/error');
const RazorpayInstance = require('../helper/payment');
const { getMembershipInfo } = require('./membershipTypeService');
const Membership = require('../models/membership');
const MembershipType = require('../models/membershiptype');
const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');

  
  async function initiateMembership({ userId }) {
      let trans;
  
      try {
          let res = await precheck(userId);

          const currentDate = new Date();
          let startingDate, endingDate;

          if (res.isPremium) {
              const membership = await Membership.findOne({
                  where: {
                      userId: userId,
                      status: MEMBERSHIP_SUBSCRIBED,
                      endingTime: { [Op.gt]: new Date() }
                  }
              });

              if (membership) {
                  const timeDifference = membership.endingTime - currentDate;
                  const daysDifference = timeDifference / (1000 * 3600 * 24);

                  if (daysDifference > 15) {
                      throw new CustomError('You can only renew your membership within 15 days of expiration', 400, 'MEMBERSHIP_RENEWAL_NOT_ALLOWED');
                  }

                  // Set starting date to the next day after the current membership's ending date
                  startingDate = new Date(membership.endingTime);
                  startingDate.setDate(startingDate.getDate() + 1);
              }
          }

          // If no active membership or renewal, set starting date to current date
          if (!startingDate) {
              startingDate = new Date(currentDate);
          }

          // Set time of startingDate to 00:00
          startingDate.setHours(0, 0, 0, 0);

          // Set ending date to one year from the starting date
          endingDate = new Date(startingDate);
          endingDate.setFullYear(endingDate.getFullYear() + 1);

          // Set time of endingDate to 23:59
          endingDate.setHours(23, 59, 59, 999);

          // Get user details
          const user = await User.findByPk(userId);
          if (!user) {
              throw new Error('User not found.');
          }
  
          // Start transaction
          trans = await db.transaction();

          let membershipInfo = await getMembershipInfo();
          let totalAmount;
          if (membershipInfo.membershipOfferAmount) totalAmount = parseInt(membershipInfo.membershipOfferAmount);
          else totalAmount = parseInt(membershipInfo.membershipAmount);

          // Create payment order
          const orderId = await createPaymentOrder(totalAmount * 100, TRANSACTION_TYPE_MEMBERSHIP);
          const prefills = { name: user.name, contactNumber: `${user.contactNumber}`, email: user.email };
          const transactionInfo = await Transaction.create({
              userId,
              amount: totalAmount,
              orderId,
              type: TRANSACTION_TYPE_MEMBERSHIP,
          }, { trans });

          let membershipUniqueId = uniqid.time();
          // Create a new booking
          console.log('starting', startingDate);
          console.log('ending', endingDate);
          const membership = await Membership.create({
              userId,
              amount: totalAmount,
              startingTime: startingDate,
              endingTime: endingDate,
              transactionId: transactionInfo.id,
              membershipTypeId: membershipInfo.id,
          }, { trans, returning: true });
  
          // Commit trans
          await trans.commit();
  
          return { amount: totalAmount * 100, orderId, prefills };
      } catch (error) {
          // Rollback trans if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error;
      }
  }


  async function confirmMembership({userId, paymentId, orderId, signature}) 
  {

    let trans;
  
      try {
          trans = await db.transaction();
  
          let tinfo = await Transaction.findOne({where:{orderId:orderId}});
          // Verify the payment BEFORE trusting it. This used to compute `isValid`
          // and discard it, so any authenticated caller with an orderId could
          // confirm a payment that never happened. See utils/paymentSignature.js.
          assertPaymentSignature('confirmMembership', { paymentId, orderId: tinfo.orderId, signature });
          if (tinfo) {
            await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,paymentId:paymentId});
          }
              const updatedTransaction = await Membership.update({
                  status: MEMBERSHIP_SUBSCRIBED,
              }, {
                  where: { transactionId: tinfo.dataValues.id },
                  transaction: trans,
              });
      
              if (!updatedTransaction[0]) {
                  throw new CustomError({message:'Membership not found or not updated.',status:'FAILED TO UPDATE'});
              }

              const memebership = await Membership.findOne({ where: { transactionId: tinfo.dataValues.id } });

          // Commit transaction
          await trans.commit();
  
          return memebership // Return the transactionId for further processing if needed
      } catch (error) {
          // Rollback transaction if anything fails
          if (trans) {
              await trans.rollback();
          }
          throw error.message;
      }
  }

  async function getAllMembership({filters, sort, offset=0, search, limit=10}) {
    try {
      // Construct query based on filters
      let queryOptions = {
        include: [
          {
            model: Transaction,
            as: 'transaction',
          },
          {
            model: MembershipType,
            as: 'membershipType',
          },
          {
            model: User,
            as: 'user',
          },
        ],
      };
  
      // Default sorting by createdAt in descending order
      let order;
      if (sort.startsWith('-')) {
        order = [[sort.substring(1), 'DESC']];
      } else {
        order = [[sort, 'ASC']];
      }
      queryOptions.order = order;
  
      // Handle sorting if provided
  
      // Handle offset
      if (offset) {
        queryOptions.offset = parseInt(offset);
      }
  
      // Handle search
      if (search) {
        queryOptions.where = {
          [Op.or]: [
            { '$user.name$': { [Op.like]: `%${search}%` } },
            { '$user.contactNumber$': { [Op.like]: `%${search}%` } },
            // Add more fields to search here
          ],
        };
      }
  
      // Handle limit
      if (limit) {
        queryOptions.limit = parseInt(limit);
      }
  
      // Fetch all memberships with related information based on constructed query
      const memberships = await Membership.findAll(queryOptions);
  
      // Count total number of memberships
      const totalCount = await Membership.count(queryOptions);
  
      return { data: memberships, totalCount };
    } catch (error) {
      console.error('Error fetching memberships:', error);
      throw error;
    }
  }
  

  async function getUserMembership(userId) {
    const memberships = await Membership.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });

    return memberships;
  }


  async function getMembershipById(bookingId) {
    // Fetch a specific booking with related information by ID
    const booking = await Booking.findOne({
      where:{bookingId: bookingId}, 
      include: [
        {
          model: Transaction,
          as: 'transaction',
        },
        {
          model: Vehicle,
          as: 'vehicle',
          include:[
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
    // console.log('boboking',booking.dataValues.orderId)
    let res = {};
    if(booking.transaction.paymentId) res = await RazorpayInstance.payments.fetch(booking.transaction.paymentId);

    return {...booking.toJSON(),payment:res};
  }


  async function isSlotFree(vehicleId, startDateTime, endDateTime) {
    const overlappingTransaction = await Booking.findOne({
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
      },
    });

    return !overlappingTransaction;
  }

module.exports = {initiateMembership,getAllMembership,getUserMembership,getMembershipById,isSlotFree,confirmMembership}
