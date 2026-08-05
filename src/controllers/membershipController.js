const { CustomError } = require('../middlewares/error');
const membershipService = require('../services/membershipService');

class MembershipController {

  async initiateMembership(req, res,next) {
    try {
      const transaction = await membershipService.initiateMembership({userId:req.userId});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }


  async confirmMembership(req, res,next) {
    const { paymentId, orderId, signature } = req.body;
    try {
      const transaction = await membershipService.confirmMembership({userId:req.userId, paymentId, orderId, signature});
      res.status(201).json(transaction);
    } catch (error) {
      console.log(JSON.stringify(error))
      next(error);
    }
  }

  async bookVehicle(req, res) {
    const { vehicleId, startTime, endTime } = req.body;
    try {
      const transaction = await membershipService.confirmBooking(req.userId, vehicleId, startTime, endTime);
      res.status(201).json(transaction);
    } catch (error) {
      console.log(error)
      res.status(400).json({ error: error.message });
    }
  }

  async getAllMembership(req, res) {
    try {
      const {filters, sort, offset, search, limit} = req.query;
      const bookings = await membershipService.getAllMembership({filters, sort, offset, search, limit});
      res.status(200).json(bookings);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getUserBookings(req, res) {
    try {
      const { id } = req.params;
      const bookings = await membershipService.getUserBookings(id);
      res.status(200).json(bookings);
    } catch (error) {
        console.log(error)
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  async getBookingById(req, res) {
    const { id } = req.params;
    
    try {
      const booking = await membershipService.getBookingById(id);
      
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

  async getUserMembership(req, res) {
    try {
      const {userId} = req.body;
      const memberships = await membershipService.getUserMembership(userId);
      res.status(200).json(memberships);
    } catch (error) {
      if(error instanceof CustomError) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  } 

}



module.exports = new MembershipController();
