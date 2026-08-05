const {Sequelize,DataTypes} = require('sequelize'); 
const db = require('../configs/db');


const HostPayoutAccount = db.define('hostPayoutAccount',{
    id:{type:DataTypes.UUID,primaryKey:true,defaultValue:DataTypes.UUIDV4},
    hostId:{type:DataTypes.UUID,allowNull:false},
    paymentMethod:{type:DataTypes.ENUM('bank','upi'),allowNull:false,defaultValue:'bank'},
    accountNumber:{type:DataTypes.STRING,allowNull:false}, // Only stores last 4 digits
    hostProvidedName:{type:DataTypes.STRING,allowNull:false},
    accountHolderName:{type:DataTypes.STRING,allowNull:false},
    isVerified:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},
    isManuallyVerified:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},
    referenceId:{type:DataTypes.STRING,allowNull:true},
    ifscCode:{type:DataTypes.STRING,allowNull:false},
    bankName:{type:DataTypes.STRING,allowNull:false},
    upiId:{type:DataTypes.STRING,allowNull:true},
    upiHandle:{type:DataTypes.STRING,allowNull:true},
    city:{type:DataTypes.STRING,allowNull:true},
    utrNumber:{type:DataTypes.STRING,allowNull:true},
    branchName:{type:DataTypes.STRING,allowNull:true},
    micrCode:{type:DataTypes.STRING,allowNull:true},
    nameMatchScore:{type:DataTypes.FLOAT,allowNull:true},
    nameMatchStatus:{type:DataTypes.STRING,allowNull:true},
    upiName:{type:DataTypes.STRING,allowNull:true},
    isActive:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:true},
    razorpayContactId:{type:DataTypes.STRING,allowNull:true}, // Razorpay Linked Account ID
    razorpayFundAccountId:{type:DataTypes.STRING,allowNull:true}, // Razorpay Stakeholder ID
});

module.exports = HostPayoutAccount;