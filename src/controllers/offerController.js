const { CustomError } = require('../middlewares/error');
const offerService = require('../services/offerService');

class OfferController {
  async createOffer(req, res) {
    try {
      const offer = await offerService.createOffer(req.body);
      res.status(201).json(offer);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async validateOffer(req, res) {
    try {
      const { offerId } = req.params;
      const userId = req.body.userId;
      const offer = await offerService.validateOffer(offerId, userId,req.query.vehicleId,req.query.startTime,req.query.endTime);
      if (!offer) {
        return res.status(404).json({ message: 'Invalid or expired offer' });
      }
      res.json(offer);
    } catch (error) {
      console.log(error)
      if(error instanceof CustomError){
        res.status(400).json({ error: error.message });
      }else{
        res.status(400).json({ error: error.message });
      }
    }
  }

  async getOffers(req, res) {
    try {
      const offers = await offerService.getOffers();
      res.json(offers);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
  
  async getBookingOffer(req, res) {
    try {
      const {userId}= req.body;
      const {vehicleId}= req.params;
      const { startTime, endTime ,viewAll} = req.query;
      const offers = await offerService.getBookingOffer(userId,vehicleId,startTime,endTime,viewAll);
      res.json(offers);
    } catch (error) {
      console.log(error)
      if(error instanceof CustomError){
        res.status(400).json({ error: error.message });
      }else{
        res.status(400).json({ error: error.message });
      }
    }
  }
  
}
module.exports = new OfferController(); 