const { DataTypes } = require('sequelize');
const sequelize = require('../configs/db');

const HostInvoice = sequelize.define('hostInvoice', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  hostId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  payoutLedgerId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  
  // Invoice details
  invoiceNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    comment: 'Invoice number format: INV-HOST-HOSTID-TIMESTAMP'
  },
  invoiceDate: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  dueDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  // Line items JSON array
  lineItems: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: 'Array of {bookingId, description, amount}'
  },
  
  // Amounts
  subtotal: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Subtotal before GST'
  },
  taxAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'GST tax amount'
  },
  totalAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Final total amount'
  },
  
  // GST Details
  gstNumber: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  gstRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 5.00,
  },
  
  // Commission details for reference
  commissionPercentage: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
  },
  commissionAmount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  
  // Status
  status: {
    type: DataTypes.ENUM,
    values: ['draft', 'issued', 'sent', 'paid', 'cancelled'],
    defaultValue: 'draft',
  },
  pdfUrl: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
});

module.exports = HostInvoice;
