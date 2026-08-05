const {DataTypes} = require('sequelize');
const db = require('../configs/db');

const FcmToken = db.define('fcmToken',{
    id:{type:DataTypes.UUID,primaryKey:true,defaultValue:DataTypes.UUIDV4},
    token:{type:DataTypes.STRING,allowNull:false},
    userId:{type:DataTypes.STRING,allowNull:false},
    deviceId:{type:DataTypes.STRING,allowNull:true}
})

module.exports = FcmToken;