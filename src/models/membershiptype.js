const { DataTypes } = require('sequelize');
const db = require('../configs/db'); // assuming you have a database configuration file
const { v4 } = require('uuid');
const MembershipType = db.define('membershiptype', {
  id: {
    type: DataTypes.UUID,
    defaultValue:()=>v4(),
    primaryKey: true,
  },
  membershipName:
  {
    type:DataTypes.STRING,
    allowNull:false
},
membershipAmount:
{
    type:DataTypes.FLOAT,
    allowNull:false
  },
  membershipOfferAmount:
  {
    type:DataTypes.FLOAT,
    allowNull:true
  },
  membershipRideOffer:
  {
    type:DataTypes.FLOAT,
    defaultValue:0.00
  },
  membershipOfferMax:{
    type:DataTypes.FLOAT,
    defaultValue:null
  },
  status:
  {
    type:DataTypes.BOOLEAN,
    defaultValue:true
  },
});

// Transaction.belongsTo(User, { foreignKey: 'userId', as: 'user' })

module.exports = MembershipType;
