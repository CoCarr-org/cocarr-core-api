const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const HostPayoutLedger = sequelize.define('hostPayoutLedger', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  hostId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  bookingId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  
  // Payment breakdown
  initialBookingAmount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Total booking amount'
  },
  extensionAmount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Extension payment amount'
  },
  dueAmount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Due payment amount (only host share if shared)'
  },
  totalGrossAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Sum of all payments before commission'
  },
  
  // Excluded from commission calculation
  convenienceFee: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  deliveryFee: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  protectionPlanFee: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  
  // Commission & Tax
  commissionPercentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    comment: 'Commission percentage applied'
  },
  commissionableAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Amount on which commission is calculated (excludes fees)'
  },
  commissionAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Commission deducted'
  },
  hostNetAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'After commission deduction'
  },
  
  // GST Calculation
  gstPercentage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 5.00,
    comment: 'GST rate (5% or 18%)'
  },
  gstAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'GST calculated on hostNetAmount'
  },
  hostPayableAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Final amount payable to host (after GST)'
  },
  
  // Host commission info for reference
  hostCommissionId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  
  // Payout status
  // Set when this booking is pulled into a weekly settlement batch. NULL means
  // the booking is still unsettled — which is exactly what the Monday job
  // looks for, so it can never pick the same ledger row up twice.
  settlementId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  payoutStatus: {
    type: DataTypes.ENUM,
    values: ['pending', 'processed', 'completed', 'failed'],
    defaultValue: 'pending',
  },
  razorpayTransferId: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  invoiceId: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  payoutDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  failureReason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

module.exports = HostPayoutLedger;
