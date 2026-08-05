const { Op } = require('sequelize');
const Razorpay = require('razorpay');
const { TRANSACTION_TYPE_BOOKING } = require('../configs/constants');
const { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const Transaction = require('../models/transaction');

var RazorpayInstance = new Razorpay({
  key_id: process.env.PG_KEY,
  key_secret: process.env.PG_SEC,
});

async function createPaymentOrder(data,type) {
  console.log('data',data)
  try {
    var options = {
      amount: data,  // amount in the smallest currency unit
      currency: "INR",
      notes:
      {
        type:type
      }
      // receipt: "order_rcptid_11"
    };
    let res = await RazorpayInstance.orders.create(options);
    return res.id;
  } catch (error) {
    console.log('eror',error)
    throw new Error('Could not fetch payment order');
  }
}

async function verifyPayment(data,type) {
  console.log('data',data)
  try {
    var options = {
      amount: data,  // amount in the smallest currency unit
      currency: "INR",
      notes:
      {
        type:type
      }
      // receipt: "order_rcptid_11"
    };
    let res = await RazorpayInstance.orders.create(options);
    return res.id;
  } catch (error) {
    console.log('eror',error)
    throw new Error('Could not fetch pickups');
  }
}

// validatePaymentVerification({"order_id": razorpayOrderId, "payment_id": razorpayPaymentId }, signature, secret);



async function getAllPayments(data) {
  try {
    var options = {}
    let res = await Transaction.findAll({});
    return res;
  } catch (error) {
    console.log('eror',error)
    throw new Error('Could not fetch pickups');
  }
}




module.exports = {createPaymentOrder,getAllPayments};
