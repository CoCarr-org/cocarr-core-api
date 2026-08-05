const { Op } = require('sequelize');
const Due = require('../models/due');
const { precheck } = require('./userService');
const { DUE_CREATED, TRANSACTION_TYPE_DUE, DUE_CANCELLED, DUE_PAID, TRANSACTION_AUTHORIZED } = require('../configs/constants');
const Transaction = require('../models/transaction');
const { createPaymentOrder } = require('./paymentService');
const User = require('../models/user');
const { CustomError } = require('../middlewares/error');
const db = require('../configs/db');
const Booking = require('../models/booking');
const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');

  const getAllDues = async ({searchText,sort,bookingId,userId,status,limit=20,offset=0}) => {
    let whereClause = {};
    if (searchText) {
      whereClause.name = { [Op.like]: `%${searchText}%` };
    }
    if (bookingId) {
      whereClause.bookingId = bookingId;
    }
    if (userId) {
      whereClause.userId = userId;
    }
    if (status) {
      whereClause.status = [DUE_CREATED, DUE_PAID, DUE_CANCELLED].includes(status) ? status : DUE_CREATED;
    }

    let order = [['createdAt', 'DESC']]; // Default sort
    if (sort) {
      // Get column name without minus symbol if present
      const columnName = sort.startsWith('-') ? sort.slice(1) : sort;
      
      let attributes = Due.getAttributes();
      // Check if columnName exists as a field in Due model
      if (Object.keys(attributes).includes(columnName)) {
        const sortOrderSign = sort.startsWith('-') ? 'DESC' : 'ASC';
        order = [[columnName, sortOrderSign]];
      }
    }

    let dues = await Due.findAll({ where: whereClause, include:[{model:User,as:'user'},{model:Booking,as:'booking',attributes:['id','bookingId']}], order, limit:parseInt(limit), offset:parseInt(offset) });
    return {
      dues,
      count:dues.length
    };
  };


const getUserDues = async (userId) => {
//   const whereClause = searchTerm
//     ? { userId,name: { [Op.like]: `%${searchTerm}%` } }
//     : {};

//   let order = [];

//   if (sortBy) {
//     const sortOrderSign = sortBy.startsWith('-') ? 'DESC' : 'ASC';
//     order = [[sortBy.replace('-', ''), sortOrderSign]];
//   } else {
//     order = [['name', 'ASC']];
//   }

  return Due.findAll({ where: {userId:userId}, include:[{model:User,as:'user'}] });
};

const getDueById = async (id) => {
  return Due.findOne({where:{id:id},include:[{model:User,as:'user'},{model:Booking,as:'booking'},{model:Transaction,as:'transaction'}]});
};

async function createDue({ userId, bookingId=null,amount,reason,remarks }) {
    let trans;

    try {
        let res = await precheck(userId)
        // Get user details
        // const user = await User.findByPk(userId);
        if (!res.user) {
            throw new CustomError('The user is not found.', 400, 'USER_NOT_FOUND');
        }
        
        // Start transaction
        trans = await db.transaction();
        
        // Create payment order
        // const orderId = await createPaymentOrder(amount*100)
        // const prefills = {name:res.user.name,contactNumber:`${res.user.contactNumber}`,}
        // const transactionInfo = await Transaction.create({
        //     userId,
        //     amount: amount*100,
        //     orderId,
        //     type:TRANSACTION_TYPE_DUE,
        // }, { trans });

        // Create a new booking
        const dueInfo = await Due.create({
            userId,
            bookingId: bookingId ? bookingId : null,
            transactionId: null,
            totalAmount:amount,
            reason,
            remarks,
            status:DUE_CREATED
        }, { trans,returning:true });

        // Commit trans
        await trans.commit();

        return dueInfo;
    } catch (error) {
      console.log(error)
        // Rollback trans if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error
    }
}

async function initiateDue({ userId, id }) {
    let trans;

    try {
        let res = await precheck(userId)
        // Get user details
        const dueInfo = await Due.findByPk(id);
        if (!dueInfo) {
            throw new CustomError('The due is not found.', 400, 'DUE_NOT_FOUND');
        }
        
        // Start transaction
        trans = await db.transaction();
        
        // Create payment order
        const orderId = await createPaymentOrder(dueInfo.totalAmount*100)
        const prefills = {name:res.user.name,contactNumber:`${res.user.contactNumber}`,email:res.user.email}
        const transactionInfo = await Transaction.create({
            userId,
            amount: dueInfo.totalAmount*100,
            orderId,
            type:TRANSACTION_TYPE_DUE,
        }, { trans });

        if (dueInfo) {
            await dueInfo.update({orderId:orderId,transactionId:transactionInfo.id});
          }
            //   const updatedTransaction = await Due.update({
            //       status: DUE_PAID
            //   }, {
            //       where: { transactionId: dueInfo.dataValues.id },
            //       transaction: trans,
            //   });
      
            //   if (!updatedTransaction[0]) {
            //       throw new CustomError({message:'Due not found or not updated.',status:'FAILED TO UPDATE'});
            //   }

        // Commit trans
        await trans.commit();

        return {amount:dueInfo.totalAmount*100,orderId,prefills};;
    } catch (error) {
      console.log(error)
        // Rollback trans if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error
    }
}

async function confirmDue({userId, paymentId, orderId, signature}) 
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
        assertPaymentSignature('confirmDue', { paymentId, orderId: tinfo.orderId, signature });
        if (tinfo) {
          await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,paymentId:paymentId});
        }
            const updatedTransaction = await Due.update({
                status: DUE_PAID
            }, {
                where: { transactionId: tinfo.dataValues.id },
                transaction: trans,
            });
    
            if (!updatedTransaction[0]) {
                throw new CustomError({message:'Due not found or not updated.',status:'FAILED TO UPDATE'});
            }

        // Commit transaction
        await trans.commit();

        return updatedTransaction // Return the transactionId for further processing if needed
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


const updateDue = async ({id,userId, bookingId=null, dateTime,amount }) => {
  try {
    // Check if the updated brand name already exists in other rows
    const existingBrand = await Due.findOne({
      where: {
        name: updatedBrandData.name,
        id: { [Op.not]: id }, // Exclude the current brand being updated
      },
    });

    if (existingBrand) {
      throw new Error('Brand name already exists');
    }

    const brand = await Due.findByPk(id);

    if (brand) {
      await Due.update(updatedBrandData);
      return brand;
    }

    return null;
  } catch (error) {
    throw error;
  }
};

const cancelDue = async ({id,reason}) => {
    try {
      // Find the Due record by its primary key
      const due = await Due.findByPk(id);
  
      if (!due) {
        // Return null if the Due record doesn't exist
        return null;
      }
  
      // Update the status to "cancel"
      await due.update({ status: DUE_CANCELLED,cancelledReason:reason});
  
      // Return the updated content
      return due;
    } catch (error) {
      // Handle any errors
      console.error('Error cancelling due:', error);
      throw error;
    }
  };

const deleteDue = async (id) => {
  const brand = await Due.findByPk(id);
  if (brand) {
    await Due.destroy();
    return true;
  }
  return false;
};

module.exports = {
  getAllDues,
  getDueById,
  getUserDues,
  createDue,
  updateDue,
  cancelDue,
  deleteDue,
  confirmDue,
  initiateDue
};
