const Offer = require('./offer');
const OfferCities = require('./offerCities');
const City = require('./city');
const Booking = require('./booking');
const Review = require('./review');
const Refund = require('./refund');
const Transaction = require('./transaction');
const User = require('./user');
const Wallet = require('./wallet');
const WalletTransaction = require('./wallettransaction');
const HostReview = require('./hostReview');
const Host = require('./host');
const Schedule = require('./schedule');
const ScheduleBlock = require('./scheduleBlock');
const Vehicle = require('./vehicle');
const VehiclePreference = require('./vehiclePreference');
const Pickup = require('./pickuppoint');
const VehiclePlan = require('./vehicleplan');
const Image = require('./image');
const HostPayoutAccount = require('./hostPayoutAccount');
const HostCommission = require('./hostCommission');
const HostPayoutLedger = require('./hostPayoutLedger');
const HostInvoice = require('./hostInvoice');
const Due = require('./due');
const Damage = require('./damage');
const ProtectionPlan = require('./protectionplan');

// Offer.belongsToMany(City, { through: OfferCities, foreignKey: 'offerId', otherKey: 'cityId' });
// City.belongsToMany(Offer, { through: OfferCities, foreignKey: 'cityId', otherKey: 'offerId' });
Booking.hasOne(Review,{foreignKey:'bookingId'})
Review.belongsTo(Booking,{foreignKey:'bookingId'})
Refund.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' })
Refund.belongsTo(Transaction, { foreignKey: 'transactionId', as: 'transaction' })



// Wallet.belongsTo(User, { foreignKey: 'userId', as: 'user' })
WalletTransaction.belongsTo(Wallet, { foreignKey: 'walletId', as: 'wallet' })
WalletTransaction.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Wallet.hasMany(WalletTransaction, { foreignKey: 'walletId', as: 'walletTransactions' })
Wallet.belongsTo(User, { foreignKey: 'userId', as: 'user' })
// User.hasOne(Wallet, { foreignKey: 'userId', as: 'wallet' })


HostReview.belongsTo(User, { foreignKey: 'userId', as: 'user' });
HostReview.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });
HostReview.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });
Booking.hasOne(HostReview,{foreignKey:'bookingId'})

Schedule.hasMany(ScheduleBlock, { foreignKey: 'scheduleId', as: 'scheduleBlocks' });
Schedule.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
Vehicle.hasMany(Schedule, { foreignKey: 'vehicleId', as: 'schedules' });
ScheduleBlock.belongsTo(Schedule, { foreignKey: 'scheduleId', as: 'schedule' });

VehiclePreference.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });
VehiclePreference.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });
Vehicle.hasOne(VehiclePreference, { foreignKey: 'vehicleId', as: 'vehiclePreference' });
Vehicle.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });

Host.hasMany(Vehicle, { foreignKey: 'hostId', as: 'vehicles' });
Host.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasOne(Host, { foreignKey: 'userId', as: 'host' });

Host.hasMany(HostPayoutAccount, { foreignKey: 'hostId', as: 'hostPayoutAccount' });
HostPayoutAccount.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });

Host.hasMany(HostCommission, { foreignKey: 'hostId', as: 'hostCommissions' });
HostCommission.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });

Host.hasMany(HostPayoutLedger, { foreignKey: 'hostId', as: 'payoutLedgers' });
HostPayoutLedger.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });

HostPayoutLedger.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' });
Booking.hasMany(HostPayoutLedger, { foreignKey: 'bookingId', as: 'payoutLedgers' });

Host.hasMany(HostInvoice, { foreignKey: 'hostId', as: 'invoices' });
HostInvoice.belongsTo(Host, { foreignKey: 'hostId', as: 'host' });

HostInvoice.belongsTo(HostPayoutLedger, { foreignKey: 'payoutLedgerId', as: 'payout' });
HostPayoutLedger.hasOne(HostInvoice, { foreignKey: 'payoutLedgerId', as: 'invoice' });

VehiclePlan.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

Pickup.belongsTo(City, { foreignKey: 'cityId', as: 'city' })
Pickup.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' })
Pickup.belongsTo(Host, { foreignKey: 'hostId', as: 'host' })


Due.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' })
Due.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Due.belongsTo(Transaction, { foreignKey: 'transactionId', as: 'transaction' })


Image.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' })
Vehicle.hasMany(Image, { foreignKey: 'vehicleId', as: 'images' })
Booking.hasMany(Image, { foreignKey: 'bookingId', as: 'images' })
Image.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' })

Damage.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' })
Damage.belongsTo(User, { foreignKey: 'userId', as: 'user' })
Damage.belongsTo(Transaction, { foreignKey: 'transactionId', as: 'transaction' })
Booking.hasMany(Damage, { foreignKey: 'bookingId', as: 'damages' })
User.hasMany(Damage, { foreignKey: 'userId', as: 'damages' })
Transaction.hasMany(Damage, { foreignKey: 'transactionId', as: 'damages' })


ProtectionPlan.belongsTo(Booking, { foreignKey: 'bookingId', as: 'booking' })
Booking.hasOne(ProtectionPlan, { foreignKey: 'bookingId', as: 'protectionplan' })


// module.exports = { Offer, OfferCities, City };

// ── Identity & vehicle documents (separate tables, one row per submission) ──
// `isCurrent` marks the row the app should read; older rows are kept so a
// rejected submission and its reason survive the resubmission.
const KycDocument = require('./kycDocument');
const PanCard = require('./panCard');
const DrivingLicence = require('./drivingLicence');
const VehicleRcDocument = require('./vehicleRcDocument');
const OtherDocument = require('./otherDocument');

User.hasMany(KycDocument, { foreignKey: 'userId', as: 'kycDocuments' });
KycDocument.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(PanCard, { foreignKey: 'userId', as: 'panCards' });
PanCard.belongsTo(User, { foreignKey: 'userId', as: 'user' });

User.hasMany(DrivingLicence, { foreignKey: 'userId', as: 'drivingLicences' });
DrivingLicence.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Vehicle.hasMany(VehicleRcDocument, { foreignKey: 'vehicleId', as: 'rcDocuments' });
VehicleRcDocument.belongsTo(Vehicle, { foreignKey: 'vehicleId', as: 'vehicle' });

// OtherDocument is intentionally NOT associated — it is polymorphic, so there
// is no single model to point a foreign key at. Query it by ownerType+ownerId.

// ── Referral module ──
// referrals link a referrer to a referee; referral_rewards audit each wallet
// credit; referral_campaigns hold the (admin-configurable) reward + eligibility
// rules. Tables are created by db.sync({alter:true}) on boot.
const Referral = require('./referral');
const ReferralReward = require('./referralReward');
const ReferralCampaign = require('./referralCampaign');
const ReferralCode = require('./referralCode');

// The permanent per-user code lives in its own table (referral_codes), not on
// `users`. Minted inactive, activated when the owner becomes a verified user.
User.hasOne(ReferralCode, { foreignKey: 'userId', as: 'referralCodeRecord' });
ReferralCode.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Referral.belongsTo(User, { foreignKey: 'referrerId', as: 'referrer' });
Referral.belongsTo(User, { foreignKey: 'refereeId', as: 'referee' });
Referral.belongsTo(ReferralCampaign, { foreignKey: 'campaignId', as: 'campaign' });

Referral.hasMany(ReferralReward, { foreignKey: 'referralId', as: 'rewards' });
ReferralReward.belongsTo(Referral, { foreignKey: 'referralId', as: 'referral' });
ReferralReward.belongsTo(User, { foreignKey: 'userId', as: 'user' });
