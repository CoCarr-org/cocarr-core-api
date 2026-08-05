const { Op } = require('sequelize');
const Brand = require('../models/brand');

const getAllBrands = async (searchTerm, sortBy) => {
  const whereClause = searchTerm
    ? { name: { [Op.like]: `%${searchTerm}%` } }
    : {};

  let order = [];

  if (sortBy) {
    const sortOrderSign = sortBy.startsWith('-') ? 'DESC' : 'ASC';
    order = [[sortBy.replace('-', ''), sortOrderSign]];
  } else {
    order = [['name', 'ASC']];
  }

  return Brand.findAll({ where: whereClause, order });
};

const getBrandById = async (id) => {
  return Brand.findByPk(id);
};

const createBrand = async (brandData) => {
  try {
    // Check if the brand name already exists
    const existingBrand = await Brand.findOne({ where: { name: brandData.name } });

    if (existingBrand) {
      throw new Error('Brand name already exists');
    }

    return Brand.create(brandData);
  } catch (error) {
    throw error;
  }
};

const updateBrand = async (id, updatedBrandData) => {
  try {
    // Check if the updated brand name already exists in other rows
    const existingBrand = await Brand.findOne({
      where: {
        name: updatedBrandData.name,
        id: { [Op.not]: id }, // Exclude the current brand being updated
      },
    });

    if (existingBrand) {
      throw new Error('Brand name already exists');
    }

    const brand = await Brand.findByPk(id);

    if (brand) {
      await brand.update(updatedBrandData);
      return brand;
    }

    return null;
  } catch (error) {
    throw error;
  }
};

const deleteBrand = async (id) => {
  const brand = await Brand.findByPk(id);
  if (brand) {
    await brand.destroy();
    return true;
  }
  return false;
};

// Car brands available in India, seeded on boot so the brand picker
// (frontend + app) has a consistent list with valid ids. Idempotent.
const DEFAULT_BRANDS = [
  'Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Kia', 'Toyota', 'Honda',
  'Renault', 'Volkswagen', 'Skoda', 'MG', 'Nissan', 'Ford', 'Jeep', 'Citroën',
  'Fiat', 'Datsun', 'Chevrolet', 'Isuzu', 'Force Motors', 'Mitsubishi', 'BYD',
  'Mercedes-Benz', 'BMW', 'Audi', 'Volvo', 'Jaguar', 'Land Rover', 'Lexus',
  'Mini', 'Porsche', 'Bentley', 'Rolls-Royce', 'Maserati', 'Ferrari',
  'Lamborghini', 'Aston Martin', 'Maybach', 'Lotus', 'McLaren', 'Bugatti',
];

const addDefaultBrands = async () => {
  for (const name of DEFAULT_BRANDS) {
    // Per-item so one failure doesn't abort the whole seed. Idempotent.
    try {
      await Brand.findOrCreate({ where: { name }, defaults: { name } });
    } catch (err) {
      console.error(`Failed to seed brand ${name}:`, err.message);
    }
  }
};

module.exports = {
  getAllBrands,
  getBrandById,
  createBrand,
  updateBrand,
  deleteBrand,
  addDefaultBrands,
};
