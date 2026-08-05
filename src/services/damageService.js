const { CustomError } = require('../middlewares/error');
const Booking = require('../models/booking');
const Damage = require('../models/damage');
const Transaction = require('../models/transaction');
const moment = require('moment');
const {
  DAMAGE_PENDING, DAMAGE_APPROVED, DAMAGE_REJECTED, DAMAGE_PAID,
} = require('../configs/constants');

const DAMAGE_STATUSES = [DAMAGE_PENDING, DAMAGE_APPROVED, DAMAGE_REJECTED, DAMAGE_PAID];

class DamageService {
  async createDamage({ bookingId, damageType, damageDescription, damageImage, damagedPart, damageDate }) {
    try {
      // Check if booking ended within 240 hours
      const booking = await Booking.findByPk(bookingId);
      if (!booking) {
        throw new CustomError('Booking not found', 404);
      }

      const bookingEndTime = moment(booking.endTime);
      const now = moment();
      const hoursDiff = now.diff(bookingEndTime, 'hours');

      if (hoursDiff > 240) {
        throw new CustomError('Cannot report damage after 10 days of booking end', 400);
      }

      const damage = await Damage.create({
        bookingId,
        damageType,
        damageDescription,
        damageImage: damageImage.map(img => img.url).join(','),
        damagedPart,
        damageDate,
        damageStatus: DAMAGE_PENDING
      });

      return damage;
    } catch (error) {
      if (error instanceof CustomError) throw error;
      throw new CustomError('Error creating damage record', 500);
    }
  }

  async getDamageById(id) {
    try {
      const damage = await Damage.findByPk(id);
      if (!damage) {
        throw new CustomError('Damage record not found', 404);
      }
      return damage;
    } catch (error) {
      if (error instanceof CustomError) throw error;
      throw new CustomError('Error fetching damage record', 500);
    }
  }

  async updateDamageStatus(id, damageStatus) {
    try {
      const damage = await this.getDamageById(id);

      // Accept any case from callers but persist the lowercase ENUM value.
      const normalized = String(damageStatus || '').toLowerCase();
      if (!DAMAGE_STATUSES.includes(normalized)) {
        throw new CustomError('Invalid damage status', 400);
      }

      damage.damageStatus = normalized;
      await damage.save();
      
      return damage;
    } catch (error) {
      if (error instanceof CustomError) throw error;
      throw new CustomError('Error updating damage status', 500);
    }
  }

  async getDamagesByBooking(bookingId) {
    try {
      const damages = await Damage.findAll({
        where: { bookingId },
        order: [['createdAt', 'DESC']]
      });
      return damages;
    } catch (error) {
      throw new CustomError('Error fetching damages for booking', 500);
    }
  }

  async updateDamagePayment(id, transactionId) {
    try {
      const damage = await this.getDamageById(id);
      
      const transaction = await Transaction.findByPk(transactionId);
      if (!transaction) {
        throw new CustomError('Transaction not found', 404);
      }

      damage.transactionId = transactionId;
      damage.damageStatus = DAMAGE_PAID;
      await damage.save();

      return damage;
    } catch (error) {
      if (error instanceof CustomError) throw error;
      throw new CustomError('Error updating damage payment', 500);
    }
  }
}

module.exports = new DamageService();
