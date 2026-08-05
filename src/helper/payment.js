const Razorpay = require('razorpay');

var RazorpayInstance = new Razorpay({
  key_id: process.env.PG_KEY,
  key_secret: process.env.PG_SEC,
});


module.exports = RazorpayInstance;