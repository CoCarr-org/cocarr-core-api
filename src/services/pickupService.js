const { Op } = require('sequelize');
const Pickup = require('../models/pickuppoint');
const City = require('../models/city');

async function createPickup(name, cityId, address, lat, long) {
  try {
    const pickup = await Pickup.create({ name, cityId, address, lat, long });
    return pickup;
  } catch (error) {
    throw new Error('Could not create pickup');
  }
}

async function getAllPickups({ search, filter, sort, page = 1, pageSize = 10,hostAdded=false }) {
  try {
    const whereClause = {};
    const order = [];

    // Sanitize and apply filters
    if(!hostAdded) {
      whereClause.hostId = {[Op.eq]:null};
    }
    if (search) {
      
      whereClause.name = { [Op.iLike]: `%${search}%` };
    }

    if (filter) {
      // Apply additional filters based on your requirements
      // Example: whereClause.someField = filter;
    }

    // Sorting
    if (sort) {
      const [field, orderType] = sort.split(':');
      order.push([field, orderType === 'desc' ? 'DESC' : 'ASC']);
    }

    const pickups = await Pickup.findAndCountAll({
      where: whereClause,
      include:[{model:City,as:'city'}],
      order,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return pickups;
  } catch (error) {
    console.log('eror',error)
    throw new Error('Could not fetch pickups');
  }
}

async function getPickupById(id) {
  try {
    const pickup = await Pickup.findByPk(id);
    if (!pickup) {
      throw new Error('Pickup not found');
    }
    return pickup;
  } catch (error) {
    throw new Error('Could not fetch pickup');
  }
}

async function updatePickup(id, data) {
  try {
    const [updatedRowsCount] = await Pickup.update(data, {
      where: { id },
    });
    if (updatedRowsCount === 0) {
      throw new Error('Pickup not found');
    }
    const updatedPickup = await getPickupById(id);
    return updatedPickup;
  } catch (error) {
    throw new Error('Could not update pickup');
  }
}

async function deletePickup(id) {
  try {
    const deletedRowCount = await Pickup.destroy({
      where: { id },
    });
    if (deletedRowCount === 0) {
      throw new Error('Pickup not found');
    }
    return { message: 'Pickup deleted successfully' };
  } catch (error) {
    throw new Error('Could not delete pickup');
  }
}

module.exports = { createPickup, getAllPickups, getPickupById, updatePickup, deletePickup };
