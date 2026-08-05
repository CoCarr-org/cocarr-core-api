const Transaction = require('../models/transaction');
const Booking = require('../models/booking');
const { HOOK_PAYMENT_AUTHORIZED, HOOK_PAYMENT_CAPTURED, TRANSACTION_CAPTURED, BOOKING_BOOKED, TRANSACTION_PAID, TRANSACTION_AUTHORIZED, HOOK_ORDER_PAID, TRANSACTION_TYPE_MEMBERSHIP, MEMBERSHIP_SUBSCRIBED } = require('../configs/constants');
const db = require('../configs/db');
const { CustomError } = require('../middlewares/error');
const Membership = require('../models/membership');


const webhookHandler = async (data) => {

  if(data.event === HOOK_PAYMENT_AUTHORIZED)
  { 
    return authorizePayment(data)
}
else if(data.event === HOOK_PAYMENT_CAPTURED)
{
      return capturePayment(data)
}
else if(data.event === HOOK_ORDER_PAID)
{
    return orderPaid(data)
}
// Host payout transfers. Razorpay emits transfer.processed / transfer.failed /
// transfer.reversed against the transfer we created for a weekly settlement —
// this is what moves a settlement from "submitted" to its final state, so the
// admin panel reflects what actually happened at the gateway rather than what
// we hoped would happen when we submitted.
else if(typeof data.event === 'string' && data.event.startsWith('transfer.'))
{
    return transferStatusChanged(data)
}
// Rider refunds. refund.processed / refund.failed close out a refundRequest —
// without this a refund stays "processing" forever even after the money lands.
else if(typeof data.event === 'string' && data.event.startsWith('refund.'))
{
    return refundStatusChanged(data)
}
else return {message:'Webhook Received'}
};


const refundStatusChanged = async (data) => {
  try {
    const entity = data?.payload?.refund?.entity;
    if (!entity) return { message: 'Refund webhook had no refund entity' };

    const refundService = require('./refundService');
    const result = await refundService.syncRefundFromGateway({
      refundId: entity.id,
      gatewayStatus: entity.status || String(data.event).split('.')[1],
      payload: entity,
    });
    return { message: 'Refund webhook processed', ...result };
  } catch (error) {
    // Acknowledge regardless — a bookkeeping failure must not make the gateway
    // retry forever.
    console.error('[webhook] refund status sync failed:', error.message);
    return { message: 'Refund webhook received but not applied', error: error.message };
  }
};

const transferStatusChanged = async (data) => {
  try {
    const entity = data?.payload?.transfer?.entity;
    if (!entity) return { message: 'Transfer webhook had no transfer entity' };

    const settlementService = require('./settlementService');
    const result = await settlementService.syncFromGateway({
      transferId: entity.id,
      // Prefer the entity's own status; fall back to the event suffix
      // (transfer.processed -> processed) when the payload omits it.
      gatewayStatus: entity.status || String(data.event).split('.')[1],
      payload: entity,
    });

    return { message: 'Transfer webhook processed', ...result };
  } catch (error) {
    // A webhook must not 500 back to the gateway for a bookkeeping failure, or
    // the provider will retry indefinitely. Log loudly and acknowledge.
    console.error('[webhook] transfer status sync failed:', error.message);
    return { message: 'Transfer webhook received but not applied', error: error.message };
  }
};

const authorizePayment = async (data) => {
    let trans;
    try {
        trans = await db.transaction();

        let tinfo = await Transaction.findOne({where:{orderId:data.payload.payment.entity.order_id}});

        if (tinfo) {
          await tinfo.update({paymentStatus: TRANSACTION_AUTHORIZED,
            paymentId:data.payload.payment.entity.id,
            paymentMethod:data.payload.payment.entity.method});
        //   return tinfo;
        }
        await trans.commit();

        return { message:'Authorization Webhook Received' }; // Return the transactionId for further processing if needed
    } catch (error) {
        console.log(error)
        // Rollback transaction if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error;
    }
};


const capturePayment = async (data) => {
    let trans;

    try {
        trans = await db.transaction();

        // Update the transaction table
        let tinfo = await Transaction.findOne({where:{orderId:data.payload.payment.entity.order_id}});

        if (tinfo) {
          await tinfo.update({paymentStatus: TRANSACTION_CAPTURED});
        }
        
        // return tinfo;
        // Get the id of the updated transaction
        // Commit transaction
        await trans.commit();

        return { message:'Authorization Webhook Received' }; // Return the transactionId for further processing if needed
    } catch (error) {
        // Rollback transaction if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error;
    }
};


const orderPaid = async (data) => {
    let trans;

    try {
        trans = await db.transaction();

        let tinfo = await Transaction.findOne({where:{orderId:data.payload.payment.entity.order_id}});

        if (tinfo) {
          await tinfo.update({paymentStatus: TRANSACTION_PAID});
        }

        if(tinfo.type === TRANSACTION_TYPE_MEMBERSHIP)
        {
            const updatedBooking = await Membership.update({
                status: MEMBERSHIP_SUBSCRIBED,
            }, {
                where: { transactionId: tinfo.dataValues.id },
                transaction: trans,
            });
    
            if (!updatedBooking[0]) {
                throw new CustomError({message:'Booking not found or not updated.',status:'FAILED TO UPDATE'});
            }
        }
        else
        {
            const updatedBooking = await Booking.update({
                status: BOOKING_BOOKED,
            }, {
                where: { transactionId: tinfo.dataValues.id },
                transaction: trans,
            });
    
            if (!updatedBooking[0]) {
                throw new CustomError({message:'Booking not found or not updated.',status:'FAILED TO UPDATE'});
            }

        }


        // Commit transaction
        await trans.commit();

        return { message:'Order Paid Webhook Received' }; // Return the transactionId for further processing if needed
    } catch (error) {
        // Rollback transaction if anything fails
        if (trans) {
            await trans.rollback();
        }
        throw error;
    }
};


module.exports = {
  webhookHandler,
  capturePayment
};
