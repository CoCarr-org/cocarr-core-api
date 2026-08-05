const walletAdmin = require('../services/walletAdminService');

// Admin wallet-transaction endpoints. Thin — every decision lives in the
// service, so the ledger screen and the user detail screen cannot disagree
// about what a transaction means.
const handler = (fn) => async (req, res) => {
  try {
    res.status(200).json(await fn(req));
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[wallet-admin]', error);
    res.status(status).json({ error: error.message });
  }
};

const listTransactions = handler((req) => walletAdmin.listTransactions(req.query));
const getTransaction = handler((req) => walletAdmin.getTransaction(req.params.id));
const getUserWallet = handler((req) => walletAdmin.getUserWallet(req.params.userId, req.query));
const getUserReferrals = handler((req) => walletAdmin.getUserReferralSummary(req.params.userId));

module.exports = { listTransactions, getTransaction, getUserWallet, getUserReferrals };
