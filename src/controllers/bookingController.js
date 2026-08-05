const { validationResult } = require('express-validator');
const bookingService = require('../services/bookingService');
const { CustomError } = require('../middlewares/error');

class BookingController {

  async initiateBooking(req, res,next) {
    const { vehicleId, startTime, endTime,address,lat,lng,deliveryType,offerId,walletPointsUsed,cityId,protectionPlan } = req.body;
    try {
      const transaction = await bookingService.initiateBooking({userId:req.body.userId, vehicleId, startTime, endTime,address,lat,lng,deliveryType,offerId:req.body.offerId,walletPointsUsed,cityId,protectionPlan:protectionPlan});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }


  async adminCreateBooking(req, res,next) {
    const { vehicleId, startDate, endDate,address,lat,lng,bookingType,userId } = req.body;
    try {
      const bookingInfo = await bookingService.adminCreateRide({userId, vehicleId, startTime:startDate, endTime:endDate,address,lat,lng,bookingType});
      res.status(201).json(bookingInfo);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  
  async bookingSummary(req, res,next) {
    const { startTime, endTime,vehicleId } = req.query;
    try {
      const transaction = await bookingService.bookingSummary({userId:req.body.userId, vehicleId, startTime, endTime});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }
  
  async initiateExtensionBooking(req, res,next) {
    const {hoursToExtend } = req.body;
    const {id:bookingId} = req.params
    try {
      const transaction = await bookingService.initiateExtensionBooking({userId:req.body.userId, bookingId, hoursToExtend});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async extentionSummary(req, res,next) {
    const { hoursToExtend } = req.body;
    const { id:bookingId } = req.params;
    try {
      const transaction = await bookingService.extentionSummary({userId:req.body.userId, bookingId, hoursToExtend});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async refundSummary(req, res,next) {
    const { id} = req.params;
    try {
      const transaction = await bookingService.refundSummary(id);
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }


  async confirmBooking(req, res,next) {
    const { signature, orderId, paymentId, userId } = req.body;
    try {
      const transaction = await bookingService.confirmBooking({userId:userId, orderId, paymentId, signature});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async createReview(req, res,next) {
    const errors = validationResult(req);
    if(errors.length>0) throw errors;

    const { cleanliness,comfort,host,comment,userId } = req.body;

    try {
      const transaction = await bookingService.createReview({userId,cleanliness,comfort,host,comment,bookingId:req.params.id});
      res.status(201).json(transaction);
    } catch (error) {
      console.log('error',JSON.stringify(error))
      next(error);
    }
  }
  

  async confirmExtension(req, res,next) {
    const { signature, orderId, paymentId, userId } = req.body;
    try {
      const transaction = await bookingService.confirmExtension({userId:userId, orderId, paymentId, signature});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }
  
  
  async userCancelBooking(req, res,next) {
    const { userId } = req.body;
    const { id } = req.params;
    try {
      const transaction = await bookingService.userCancelBooking(userId,id);
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async startRide(req, res,next) {
    const { startKms,startDateTime,startOtp,startImages } = req.body;
    const { id } = req.params;
    try {
      const transaction = await bookingService.startRide(id,{startKms,startDateTime,bookingId:id,startOtp,startImages});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async endRide(req, res,next) {
    const { endKms,endDateTime,endOtp,endImages } = req.body;
    const { id } = req.params;
    try {
      const transaction = await bookingService.endRide(id,{endKms,endDateTime,bookingId:id,endOtp,endImages});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async bookVehicle(req, res) {
    const { vehicleId, startTime, endTime } = req.body;
    try {
      const transaction = await bookingService.confirmBooking(req.userId, vehicleId, startTime, endTime);
      res.status(201).json(transaction);
    } catch (error) {
      console.log(error)
      res.status(400).json({ error: error.message });
    }
  }

  async getAllBookings(req, res) {
    try {
      const {search,sort,offset,limit,userId,vehicleId,status,cityId} = req.query
      const bookings = await bookingService.getAllBookings({search,sort,offset,limit,userId,vehicleId,status,cityId});
      res.status(200).json(bookings);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getUserBookings(req, res) {
    try {
      const { id } = req.params;
      const bookings = await bookingService.getUserBookings(id);
      res.status(200).json(bookings);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getBookingById(req, res) {
    const { id } = req.params;
    
    try {
      const booking = await bookingService.getBookingById(id);
      
      if (!booking) {
        res.status(404).json({ error: 'Booking not found' });
      } else {
        res.status(200).json(booking);
      }
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async rescheduleSummary(req, res) {
    const { id } = req.params;
    // const { startTime, endTime } = req.body;
    try {
      const transaction = await bookingService.rescheduleSummary({id });
      res.status(201).json(transaction);  
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
  
  async initiateReschedule(req, res) {
    const { id } = req.params;
    const { startTime } = req.body;
    try {
      const transaction = await bookingService.initiateReschedule({ id, startTime });
      res.status(201).json(transaction);
    } catch (error) {
      console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getLastBooking(req, res) {
    const { userId } = req.body;
    try {
      console.log('last booking',userId)
      const booking = await bookingService.getLastBooking(userId);
      res.status(200).json(booking);
    } catch (error) {
      if(error instanceof CustomError) {
        res.status(500).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  }
  
  
  async confirmReschedule(req, res) {
    const { signature, orderId, paymentId, userId } = req.body;
    try {
      const transaction = await bookingService.confirmReschedule({userId:userId, orderId, paymentId, signature});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(error)
      res.status(500).json(error);
    }
  }

  
}





module.exports = new BookingController();
