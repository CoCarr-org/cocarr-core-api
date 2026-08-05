const Influencer = require('../models/influencer');

class InfluencerService {
  async createInfluencer(influencerData) {
    return await Influencer.create(influencerData);
  }

  async getByReferralCode(code) {
    return await Influencer.findOne({ where: { referral_code: code } });
  }

  async updateCommission(id, commission) {
    const influencer = await Influencer.findByPk(id);
    if (!influencer) return null;
    return await influencer.update({ commission_percent: commission });
  }
}

module.exports = new InfluencerService(); 