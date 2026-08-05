const { DataTypes } = require('sequelize');
const db = require('../configs/db');
const { v4: uuidv4 } = require('uuid');
const { toPublicUrl } = require('../utils/publicUrl');

// CMS — a promotional banner. imageUrl runs through the image proxy getter
// for the same private-bucket reason as User.profilePhoto.
const Banner = db.define('banner', {
  id: { type: DataTypes.STRING, primaryKey: true, defaultValue: () => uuidv4() },
  title: { type: DataTypes.STRING, allowNull: false },
  imageUrl: {
    type: DataTypes.STRING,
    allowNull: true,
    get() { return toPublicUrl(this.getDataValue('imageUrl')); },
  },
  linkUrl: { type: DataTypes.STRING, allowNull: true },
  placement: { type: DataTypes.STRING, defaultValue: 'home' },
  sortOrder: { type: DataTypes.INTEGER, defaultValue: 0 },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  startsAt: { type: DataTypes.DATE, allowNull: true },
  endsAt: { type: DataTypes.DATE, allowNull: true },
});

module.exports = Banner;
