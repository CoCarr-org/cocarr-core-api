'use strict';

const { v4 } = require("uuid");

module.exports = {
  async up(queryInterface, Sequelize) {
    try {
      // Get all vehicles without hostId and ownerType = 1
      const vehicles = await queryInterface.sequelize.query(
        `SELECT id, isDeliveryAvailable FROM vehicles WHERE hostId IS NULL`,
        { type: Sequelize.QueryTypes.SELECT }
      );

      if (!vehicles.length) {
        console.log('No vehicles found matching criteria');
        return;
      }

      // Create schedule entries for each vehicle
      const now = new Date();
      const oneMonthFromNow = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      const scheduleEntries = vehicles.map(vehicle => ({
        id: v4(),
        vehicleId: vehicle.id,
        startTime: now,
        endTime: oneMonthFromNow,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      await queryInterface.bulkInsert('schedules', scheduleEntries);

      // Create vehicle preferences for each vehicle
      const preferenceEntries = vehicles.map(vehicle => ({
        id: v4(),
        vehicleId: vehicle.id,
        midnightBooking: true,
        selfPickup: vehicle.isPickupAvailable || false,
        deliverAvailable: vehicle.isDeliveryAvailable || false,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      await queryInterface.bulkInsert('vehiclepreferences', preferenceEntries);

      console.log(`Created schedules and preferences for ${vehicles.length} vehicles`);
    } catch (error) {
      console.error('Migration failed:', error);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    try {
      // Get the vehicle IDs
      const vehicles = await queryInterface.sequelize.query(
        `SELECT id FROM vehicles WHERE hostId IS NULL`,
        { type: Sequelize.QueryTypes.SELECT }
      );

      const vehicleIds = vehicles.map(v => v.id);

      // Delete the created schedules
      await queryInterface.bulkDelete('schedules', {
        vehicleId: {
          [Sequelize.Op.in]: vehicleIds
        }
      });

      // Delete the created preferences
      await queryInterface.bulkDelete('vehiclepreferences', {
        vehicleId: {
          [Sequelize.Op.in]: vehicleIds
        }
      });

      console.log(`Removed schedules and preferences for ${vehicles.length} vehicles`);
    } catch (error) {
      console.error('Migration rollback failed:', error);
      throw error;
    }
  }
}; 