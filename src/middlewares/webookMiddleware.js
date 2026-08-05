const { validateWebhookSignature } = require('razorpay/dist/utils/razorpay-utils');


const razorpayWebhookMiddleware = (req, res, next) => {
    const webhookBody = req.body; // Assuming webhookBody is the request body
    const webhookSignature = req.get('X-Razorpay-Signature'); // Assuming the signature is sent in the header
    console.log('webookh',req.body)
    if (!webhookSignature) {
        return res.status(400).send('Signature header missing');
    }

    try {
        // Validate webhook signature
        const isValid = validateWebhookSignature(JSON.stringify(webhookBody), webhookSignature, process.env.PG_HIDDEN);

        if (!isValid) {
            return res.status(401).send('Invalid signature');
        }

        // Signature is valid, proceed to next middleware
        next();
    } catch (error) {
        console.error('Error validating webhook signature:', error);
        return res.status(500).send('Payment Gateway error');
    }
};

module.exports = razorpayWebhookMiddleware;