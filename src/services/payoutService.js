const { Op, literal } = require('sequelize');
const { CustomError } = require('../middlewares/error');
const Host = require('../models/host');
const Booking = require('../models/booking');
const Transaction = require('../models/transaction');
const Extension = require('../models/extension');
const Due = require('../models/due');
const HostCommission = require('../models/hostCommission');
const HostPayoutLedger = require('../models/hostPayoutLedger');
const HostInvoice = require('../models/hostInvoice');
const { TRANSACTION_TYPE_BOOKING, TRANSACTION_TYPE_EXTENSION, TRANSACTION_TYPE_DUE, TRANSACTION_PAID } = require('../configs/constants');
const db = require('../configs/db');
const moment = require('moment');
const RazorpayInstance = require('../helper/payment');

/**
 * Calculate host payout for a single booking with all transactions
 * Commission logic:
 * - Applied only on: totalAmount - (convenienceFee + deliveryFee + protectionPlanFee)
 * - For dues: only on host's share if dueType is 'shared'
 */
const calculateBookingPayout = async (bookingId) => {
  try {
    const booking = await Booking.findByPk(bookingId, {
      include: [
        { model: Host, as: 'host' },
        { model: Transaction, as: 'transaction' }
      ]
    });

    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }

    // Get all transactions for this booking
    const bookingTransaction = await Transaction.findOne({
      where: { id: booking.transactionId, paymentStatus: TRANSACTION_PAID }
    });

    const extensions = await Extension.findAll({
      where: { bookingId }
    });

    const dues = await Due.findAll({
      where: { bookingId }
    });

    // Calculate amounts by type
    let initialBookingAmount = bookingTransaction?.amount || 0;
    let extensionAmount = 0;
    let dueAmount = 0;

    // Sum extension amounts
    for (const extension of extensions) {
      const extensionTxn = await Transaction.findOne({
        where: { id: extension.transactionId, paymentStatus: TRANSACTION_PAID }
      });
      if (extensionTxn) {
        extensionAmount += extensionTxn.amount;
      }
    }

    // Sum due amounts - only host's share
    for (const due of dues) {
      if (due.status === 'paid') {
        if (due.dueType === 'host') {
          dueAmount += due.totalAmount;
        } else if (due.dueType === 'shared' && due.hostAmount) {
          dueAmount += due.hostAmount;
        }
        // 'company' type dues are not added to host payout
      }
    }

    // Get current active commission for host
    const hostCommission = await HostCommission.findOne({
      where: { hostId: booking.hostId, isActive: true }
    });

    if (!hostCommission) {
      throw new CustomError('No active commission found for host', 404);
    }

    // Extract fees from booking
    const convenienceFee = booking.convenienceFee || 0;
    const deliveryFee = booking.deliveryFee || 0;
    const protectionPlanFee = booking.protectionPlanFee || 0;

    // Total gross before fees
    const totalGrossAmount = initialBookingAmount + extensionAmount + dueAmount;

    // Commissionable amount excludes fees
    const commissionableAmount = totalGrossAmount - (convenienceFee + deliveryFee + protectionPlanFee);

    // Calculate commission
    const commissionPercentage = parseFloat(hostCommission.commissionPercentage);
    const commissionAmount = Math.round(commissionableAmount * (commissionPercentage / 100));

    // Host net amount after commission
    const hostNetAmount = totalGrossAmount - commissionAmount;

    // Get GST rate (default 5%)
    const gstPercentage = 5.00; // Can be made configurable
    const gstAmount = Math.round(hostNetAmount * (gstPercentage / 100));

    // Final payable amount
    const hostPayableAmount = hostNetAmount + gstAmount;

    return {
      hostId: booking.hostId,
      bookingId,
      initialBookingAmount,
      extensionAmount,
      dueAmount,
      totalGrossAmount,
      convenienceFee,
      deliveryFee,
      protectionPlanFee,
      commissionPercentage,
      commissionableAmount,
      commissionAmount,
      hostNetAmount,
      gstPercentage,
      gstAmount,
      hostPayableAmount,
      hostCommissionId: hostCommission.id
    };
  } catch (error) {
    console.error('Error calculating booking payout:', error);
    throw error;
  }
};

/**
 * Create payout ledger entry for a booking
 */
const createPayoutLedger = async (bookingId) => {
  const transaction = await db.transaction();
  try {
    // Calculate payout
    const payoutData = await calculateBookingPayout(bookingId);

    // Create ledger entry
    const ledger = await HostPayoutLedger.create(payoutData, { transaction });

    await transaction.commit();
    return ledger;
  } catch (error) {
    await transaction.rollback();
    console.error('Error creating payout ledger:', error);
    throw error;
  }
};

/**
 * Get pending payouts for a host
 */
const getHostPendingPayouts = async (hostId) => {
  try {
    const payouts = await HostPayoutLedger.findAll({
      where: {
        hostId,
        payoutStatus: 'pending'
      },
      include: [
        { model: Booking, as: 'booking' }
      ],
      order: [['createdAt', 'ASC']]
    });

    return payouts;
  } catch (error) {
    console.error('Error fetching host pending payouts:', error);
    throw error;
  }
};

/**
 * Consolidate and process payout via Razorpay
 */
const processHostPayout = async (hostId) => {
  const transaction = await db.transaction();
  try {
    // Get all pending payouts for host
    const pendingPayouts = await HostPayoutLedger.findAll({
      where: {
        hostId,
        payoutStatus: 'pending'
      },
      transaction
    });

    if (pendingPayouts.length === 0) {
      throw new CustomError('No pending payouts found for host', 404);
    }

    // Calculate total payout
    let totalPayoutAmount = 0;
    for (const payout of pendingPayouts) {
      totalPayoutAmount += payout.hostPayableAmount;
    }

    // Get host with Razorpay account details
    const host = await Host.findByPk(hostId, {
      // './hostPayoutAccount' resolved to src/services/, where no such file
      // exists — this threw MODULE_NOT_FOUND before ever reaching the gateway.
      include: [{ model: require('../models/hostPayoutAccount'), as: 'hostPayoutAccount' }]
    });

    if (!host || !host.hostPayoutAccount.length) {
      throw new CustomError('Host or payout account not found', 404);
    }

    const linkedAccountId = host.hostPayoutAccount[0].razorpayContactId;

    // Create Razorpay transfer
    const transfer = await RazorpayInstance.transfers.create({
      account: linkedAccountId,
      amount: Math.round(totalPayoutAmount * 100), // Convert to paise
      currency: 'INR',
      receipt: `payout_${hostId}_${Date.now()}`,
      on_hold: false
    });

    // Update all ledger entries
    const payoutDate = new Date();
    await HostPayoutLedger.update(
      {
        payoutStatus: 'processed',
        razorpayTransferId: transfer.id,
        payoutDate
      },
      {
        where: { id: pendingPayouts.map(p => p.id) },
        transaction
      }
    );

    // Generate invoices for each payout
    for (const payout of pendingPayouts) {
      await generatePayoutInvoice(payout.id, { transaction });
    }

    await transaction.commit();

    return {
      success: true,
      hostId,
      totalAmount: totalPayoutAmount,
      transferId: transfer.id,
      payoutCount: pendingPayouts.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing host payout:', error);
    throw error;
  }
};

/**
 * Generate invoice for a payout ledger entry
 */
const generatePayoutInvoice = async (payoutLedgerId, options = {}) => {
  try {
    const { transaction } = options;

    const payout = await HostPayoutLedger.findByPk(payoutLedgerId, {
      include: [
        { model: Host, as: 'host', include: [{ model: require('./user'), as: 'user' }] },
        { model: Booking, as: 'booking' }
      ],
      transaction
    });

    if (!payout) {
      throw new CustomError('Payout ledger not found', 404);
    }

    // Generate invoice number
    const invoiceNumber = `INV-HOST-${payout.hostId.substring(0, 8)}-${Date.now()}`;

    // Prepare line items
    const lineItems = [
      {
        description: `Booking #${payout.booking.bookingId} - Rental`,
        amount: payout.initialBookingAmount,
        bookingId: payout.booking.id
      }
    ];

    if (payout.extensionAmount > 0) {
      lineItems.push({
        description: `Booking #${payout.booking.bookingId} - Extension`,
        amount: payout.extensionAmount
      });
    }

    if (payout.dueAmount > 0) {
      lineItems.push({
        description: `Booking #${payout.booking.bookingId} - Due/Damage`,
        amount: payout.dueAmount
      });
    }

    // Create invoice
    const invoice = await HostInvoice.create(
      {
        hostId: payout.hostId,
        payoutLedgerId,
        invoiceNumber,
        invoiceDate: new Date(),
        dueDate: moment().add(30, 'days').toDate(),
        lineItems,
        subtotal: payout.hostNetAmount,
        taxAmount: payout.gstAmount,
        totalAmount: payout.hostPayableAmount,
        gstNumber: payout.host.gstNumber || null,
        gstRate: payout.gstPercentage,
        commissionPercentage: payout.commissionPercentage,
        commissionAmount: payout.commissionAmount,
        status: 'issued',
        notes: `Commission: ${payout.commissionPercentage}% deducted from gross amount`
      },
      { transaction }
    );

    // Update payout ledger with invoice ID
    await payout.update({ invoiceId: invoice.id }, { transaction });

    return invoice;
  } catch (error) {
    console.error('Error generating payout invoice:', error);
    throw error;
  }
};

/**
 * Get payout summary for admin dashboard
 */
const getPayoutSummary = async () => {
  try {
    const summary = await HostPayoutLedger.findAll({
      attributes: [
        'payoutStatus',
        [db.fn('COUNT', db.col('id')), 'count'],
        [db.fn('SUM', db.col('hostPayableAmount')), 'totalAmount']
      ],
      group: ['payoutStatus'],
      raw: true
    });

    return summary;
  } catch (error) {
    console.error('Error fetching payout summary:', error);
    throw error;
  }
};

/**
 * Schedule payout ledger creation for 48 hours after booking ends
 * Called when booking finishes (BOOKING_FINISHED status)
 */
const schedulePayoutLedger = async (bookingId) => {
  try {
    const booking = await Booking.findByPk(bookingId);
    if (!booking) {
      throw new CustomError('Booking not found', 404);
    }

    // Calculate when payout should be created (48 hours from booking end time)
    const payoutScheduledTime = moment(booking.endTime).add(48, 'hours').toDate();

    // Update booking with scheduled payout time (we'll store this info in a note or separate field if needed)
    // For now, we'll rely on the cron job to check endTime + 48 hours
    console.log(`Payout scheduled for booking ${bookingId} at ${payoutScheduledTime}`);

    return {
      bookingId,
      scheduledFor: payoutScheduledTime,
      message: 'Payout scheduled successfully'
    };
  } catch (error) {
    console.error('Error scheduling payout ledger:', error);
    throw error;
  }
};

/**
 * Process scheduled payouts
 * This should be called by a cron job periodically (every hour)
 * It checks for bookings that ended 48+ hours ago and creates ledgers
 */
const processScheduledPayouts = async () => {
  const transaction = await db.transaction();
  try {
    // Calculate cutoff time: 48 hours ago
    const cutoffTime = moment().subtract(48, 'hours').toDate();

    // Find bookings that:
    // 1. Have ended (endTime <= 48 hours ago)
    // 2. Are finished (status = BOOKING_FINISHED)
    // 3. Don't have pending/processed payouts already
    const bookingsForPayout = await Booking.findAll({
      where: {
        endTime: { [Op.lte]: cutoffTime },
        status: 'finished',
        id: {
          [Op.notIn]: literal(
            `(SELECT DISTINCT bookingId FROM hostPayoutLedgers WHERE payoutStatus IN ('pending', 'processed'))`
          )
        }
      },
      include: [{ model: Host, as: 'host' }],
      transaction
    });

    console.log(`Found ${bookingsForPayout.length} bookings eligible for payout scheduling`);

    const results = [];
    for (const booking of bookingsForPayout) {
      try {
        // Check if booking has all required data for payout
        if (!booking.hostId || !booking.totalAmount) {
          console.warn(`Booking ${booking.id} missing required data, skipping`);
          continue;
        }

        // Calculate payout
        const payoutData = await calculateBookingPayout(booking.id);

        // Create ledger entry
        const ledger = await HostPayoutLedger.create(payoutData, { transaction });

        results.push({
          bookingId: booking.id,
          ledgerId: ledger.id,
          status: 'created',
          amount: ledger.hostPayableAmount
        });

        console.log(`✓ Payout ledger created for booking ${booking.id}`);
      } catch (error) {
        console.error(`✗ Failed to create payout for booking ${booking.id}:`, error.message);
        results.push({
          bookingId: booking.id,
          status: 'failed',
          error: error.message
        });
      }
    }

    await transaction.commit();

    return {
      processedCount: bookingsForPayout.length,
      successCount: results.filter(r => r.status === 'created').length,
      failedCount: results.filter(r => r.status === 'failed').length,
      results
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing scheduled payouts:', error);
    throw error;
  }
};

/**
 * Get upcoming scheduled payouts
 * Admin can view which bookings are scheduled for payout
 */
const getUpcomingScheduledPayouts = async (daysAhead = 7) => {
  try {
    // Find bookings that:
    // 1. Ended but not 48 hours yet
    // 2. Status = BOOKING_FINISHED
    // 3. Within next X days (when payout will be eligible)
    const now = moment();
    const futureTime = moment().add(daysAhead, 'days').toDate();
    const eligibleTime = moment().subtract(48, 'hours').toDate();

    const bookings = await Booking.findAll({
      where: {
        status: 'finished',
        endTime: {
          [Op.gte]: eligibleTime,
          [Op.lte]: futureTime
        },
        id: {
          [Op.notIn]: literal(
            `(SELECT DISTINCT bookingId FROM hostPayoutLedgers)`
          )
        }
      },
      include: [{ model: Host, as: 'host' }],
      order: [['endTime', 'ASC']],
      attributes: ['id', 'bookingId', 'endTime', 'totalAmount', 'hostId']
    });

    return bookings.map(booking => ({
      bookingId: booking.bookingId,
      id: booking.id,
      endTime: booking.endTime,
      payoutEligibleAt: moment(booking.endTime).add(48, 'hours').toDate(),
      totalAmount: booking.totalAmount,
      hostId: booking.hostId,
      hoursUntilEligible: moment().diff(moment(booking.endTime).add(48, 'hours'), 'hours')
    }));
  } catch (error) {
    console.error('Error fetching upcoming scheduled payouts:', error);
    throw error;
  }
};

module.exports = {
  calculateBookingPayout,
  createPayoutLedger,
  getHostPendingPayouts,
  processHostPayout,
  generatePayoutInvoice,
  getPayoutSummary,
  schedulePayoutLedger,
  processScheduledPayouts,
  getUpcomingScheduledPayouts
};
