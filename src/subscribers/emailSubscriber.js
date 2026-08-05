const { default: axios } = require("axios");
const { formatDateTime } = require("../helper/utils");
const Extension = require("../models/extension");
const { getUserInfo } = require("../services/adminService");
const { getBookingById } = require("../services/bookingService");
const { sendBookingEmail } = require("../services/mailService");
const moment = require('moment-timezone');

const sendBookingEmailEmitter = async(data) => {
    try {
        let templateId = 'd-2f1ab6b534df4178b5427a2fcd31c204';
        let bookingInfo = await getBookingById(data.bookingId)
        let userInfo = await getUserInfo(bookingInfo.userId)
        sendBookingEmail(userInfo.email,templateId,{
            "vehicleImage":bookingInfo.vehicle.images[0].url,
            "bookingId":bookingInfo.bookingId,
            "startTime":formatDateTime(moment.tz(bookingInfo.startTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "endTime":formatDateTime(moment.tz(bookingInfo.endTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "vehicleName":`${bookingInfo.vehicle.brand.name} ${bookingInfo.vehicle.vehicleName}`,
            "vehicleNumber":bookingInfo.vehicle.vehicleNumber,
            "rideAmount":`Rs.${bookingInfo.totalAmount - (bookingInfo.depositAmount + bookingInfo.convenienceFee)}/-`,
            "deposit":`Rs.${bookingInfo.depositAmount}/-`,
            "deliveryFee":`Rs.${bookingInfo.deliveryFee}/-`,
            "convenienceFee":`Rs.${bookingInfo.convenienceFee}/-`,
            "totalAmount":`Rs.${bookingInfo.totalAmount}/-`
        })

        let query = `https://control.msg91.com/api/v5/flow`

        let smsData ={
          "template_id": "6778015ed6fc056d722d39c2",
          "short_url": "0",
          "recipients": [
            {
              "mobiles": userInfo.contactNumber,
              "var1": `${bookingInfo.vehicle.brand.name} ${bookingInfo.vehicle.vehicleName}`,
              "var2": bookingInfo.bookingId,
              "var3": moment.tz(bookingInfo.startTime, 'Asia/Kolkata').format('DD-MM HH:mm A'),
              "var4": moment.tz(bookingInfo.endTime, 'Asia/Kolkata').format('DD-MM HH:mm A'),
            }
          ]
        }

      res = await axios.post(`https://control.msg91.com/api/v5/flow`,smsData,{headers:{"Content-Type":"application/json",authkey:process.env.MSG_KEY,accept: 'application/json'}})
      let userRes = await axios.post(`https://control.msg91.com/api/v5/flow`,smsData,{headers:{"Content-Type":"application/json",authkey:process.env.MSG_KEY,accept: 'application/json'}})
      // wss.emit)
      return true;
    } catch (error) {
      throw error;
    }
};

const sendCancellationEmailEmitter = async(data) => {
    try {
        let templateId = 'd-4c21b82fedf34ff98cac95586ea96ccf';
        let bookingInfo = await getBookingById(data.bookingId)
        let userInfo = await getUserInfo(bookingInfo.userId)
        sendBookingEmail(userInfo.email,templateId,{
            "vehicleImage":bookingInfo.vehicle.images[0].url,
            "bookingId":bookingInfo.bookingId,
            "startTime":formatDateTime(moment.tz(bookingInfo.startTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "endTime":formatDateTime(moment.tz(bookingInfo.endTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "vehicleName":`${bookingInfo.vehicle.brand.name} ${bookingInfo.vehicle.vehicleName}`,
            "vehicleNumber":bookingInfo.vehicle.vehicleNumber,
            "amount":`Rs.${bookingInfo.refundedAmount}/-`,
        })
      // wss.emit)
      return true;
    } catch (error) {
      throw error;
    }
};

const sendExtensionEmailEmitter = async(data) => {
    try {
        let templateId = 'd-7b4e7510ca1b4d9197e947c79c377214';
        let bookingInfo = await getBookingById(data.bookingId)
        let extensionInfo = await Extension.findByPk(data.extensionId);
        let userInfo = await getUserInfo(bookingInfo.userId)
        sendBookingEmail(userInfo.email,templateId,{
            "vehicleImage":bookingInfo.vehicle.images[0].url,
            "bookingId":bookingInfo.bookingId,
            "startTime":formatDateTime(moment.tz(bookingInfo.startTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "vehicleName":`${bookingInfo.vehicle.brand.name} ${bookingInfo.vehicle.vehicleName}`,
            "vehicleNumber":bookingInfo.vehicle.vehicleNumber,
            "existingEndTime":formatDateTime(moment.tz(extensionInfo.existingEndTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "extendedEndTime":formatDateTime(moment.tz(extensionInfo.extendedEndTime, 'Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')),
            "amount":`Rs.${data.amount}/-`,
        })
      return true;
    } catch (error) {
      throw error;
    }
};


module.exports.loadEmailListeners = (emitter) => {
    emitter.on('bookingConfirmed', sendBookingEmailEmitter);
    emitter.on('bookingCancelled', sendCancellationEmailEmitter);
    emitter.on('bookingExtended', sendExtensionEmailEmitter);
}