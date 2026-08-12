const { Op, where, Sequelize } = require('sequelize');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const Vehicle = require('../models/vehicle');
const VehiclePlan = require('../models/vehicleplan');
const Image = require('../models/image');
const Brand = require('../models/brand');
const userAuth = require('../helper/userAuth');
const { default: axios } = require('axios');
const documentStore = require('./documentStoreService');
const KycDocumentModel = require('../models/kycDocument');
const licenceVerification = require('./licenceVerificationService');
const Booking = require('../models/booking');
const Membership = require('../models/membership');
const { validationResult } = require('express-validator');
const { MEMBERSHIP_SUBSCRIBED, BOOKING_INITIATED, DUE_CREATED } = require('../configs/constants');
const Due = require('../models/due');
const { CustomError } = require('../middlewares/error');
const Wallet = require('../models/wallet');
const Host = require('../models/host');
const WalletTransaction = require('../models/wallettransaction');
const db = require('../configs/db');
const referralService = require('./referralService');


async function precheck(userId) {
    try {
      // Check if the user with the given UID exists
      let user = await User.findOne({ where: { id: userId } });
      
      let host = await Host.findOne({where:{userId:userId}})
      let firebaseUserInfo = await userAuth.getUser(userId);
      // If the user doesn't exist, create a new row with userId, email, and name
      if (!user) {
        let insertData = {};
        insertData.id = userId;
        if(firebaseUserInfo.email) insertData.email = firebaseUserInfo.email;
        if(firebaseUserInfo.emailVerified) insertData.emailVerified = firebaseUserInfo.emailVerified;
        if(firebaseUserInfo.displayName) insertData.name = firebaseUserInfo.displayName;
        if(firebaseUserInfo.photoURL) insertData.profilePhoto = firebaseUserInfo.photoURL;
        if(firebaseUserInfo.phoneNumber) insertData.contactNumber = firebaseUserInfo.phoneNumber;
        if(firebaseUserInfo.phoneNumber) insertData.contactVerified  = firebaseUserInfo.phoneNumber ? true : false;
        user = await User.create(insertData);
      }
  
      // Check if the 'name' and 'contactNumber' fields are filled
      // These flags come from the document tables now, not inline columns.
      const { kyc: kycDoc, licence: licenceDoc } = await documentStore.getAllForUser(user.id);
      const isProfileCompleted = (user.name && user.contactNumber && user.profilePhoto) ? true : false;
      const isKycVerified = kycDoc?.imageKey ? true : false;
      const isKycNumberVerified = kycDoc?.referenceId ? true : false;
      const isLicenseVerified = (licenceDoc?.frontImageKey && licenceDoc?.backImageKey) ? true : false;
      const isManuallyVerified = kycDoc?.status === 'verified';
  
      // Check if the user has an active membership
      const membership = await Membership.findOne({
        where: {
            userId: userId,
            status: MEMBERSHIP_SUBSCRIBED,
            endingTime: { [Op.gt]: new Date() } // Check if the end time is greater than the current time
        }
      });
   
      const duePayment = await Due.findOne({
        where: {
            userId: userId,
            status: DUE_CREATED
        }
      });

      // Check if the user has a wallet
      let wallet = await Wallet.findOne({ where: { userId: userId } });
      if (!wallet) {
        // If no wallet exists, create one
        wallet = await Wallet.create({ userId: userId });
      }

      // Determine if the user has a premium membership and calculate the premium end date
      const isPremium = membership ? true : false;
      const isPaymentDue = duePayment ? true : false;
      const premiumEndDate = isPremium ? membership.endTime : null;

      // Return the result
      // `verificationStatus` is lifted to the top level because every client
      // branches on it — the booking gate, and the complete-your-profile
      // prompt on web and mobile. `canBook` is the same rule the booking
      // endpoint enforces, exposed so a client can disable the button rather
      // than let the user reach a 400.
      return {
        isProfileCompleted, isKycVerified, isKycNumberVerified, isLicenseVerified,
        isManuallyVerified, isPremium, premiumEndDate, user, isPaymentDue, wallet,
        isHost: host ? true : false,
        verificationStatus: user.verificationStatus,
        canBook: user.verificationStatus === 'active' && !isPaymentDue,
      };
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }


async function sendOtp(data) {
  try {
    let user = await User.findOne({where:{contactNumber:`+91${data.mobile}`}})
    let res;
    let query = `https://control.msg91.com/api/v5/otp?template_id=66bc6dcbd6fc05698d61a734&authkey=${process.env.MSG_KEY}&mobile=+91`
    if(user) 
    {
      res = await axios.post(`${query}${data.mobile}`,{},{headers:{"Content-Type":"application/JSON"}})
      return {...res.data,userType:'existing'}
    }
    else
    {
      res = await axios.post(`${query}${data.mobile}`,{},{headers:{"Content-Type":"application/JSON"}})
      return {...res.data,userType:'new'}
    }
  } catch (error) {
    // Handle errors appropriately (e.g., log the error, throw an exception)
    console.error('Error in precheck:', error);
    throw error;
  }
}

async function verifyOtp(data) {
  try {
    let query = `https://control.msg91.com/api/v5/otp/verify?otp=${data.otp}&authkey=${process.env.MSG_KEY}&mobile=+91${data.mobile}`
    let res = await axios.get(`${query}`,{headers:{"Content-Type":"application/JSON"}})
    if(res.data.type !== 'success') throw new CustomError(res.data.message,400,res.data.type)
    let user = await User.findOne({where:{contactNumber:`+91${data.mobile}`}})
    // let res;
    if(user) 
      {
        // A suspended account cannot sign in at all. Refused before the custom
        // token is minted, so no credential is ever issued — authenticateUser
        // then backstops anyone holding a token from before the suspension.
        if (user.verificationStatus === 'suspended') {
          throw new CustomError(
            user.suspensionReason
              ? `Your account has been suspended: ${user.suspensionReason}`
              : 'Your account has been suspended. Please contact support.',
            403,
          );
        }

        let tokenInfo = await userAuth.createCustomToken(user.id);
        const membership = await Membership.findOne({
          where: {
              userId: user.id,
              status:MEMBERSHIP_SUBSCRIBED,
              endingTime: { [Op.gt]: new Date() } // Check if the end time is greater than the current time
          }
          });
      
          // Determine if the user has a premium membership and calculate the premium end date
          const isPremium = membership ? true : false;
          const premiumEndDate = isPremium ? membership.endTime : null;
        return {user:{...user.dataValues,isPremium,premiumEndDate},token:tokenInfo}
      }
      else
      {
        // FIREBASE IS THE SOURCE OF TRUTH FOR AUTH; the `users` row is our
        // projection of it. Those two can legitimately disagree, and when they
        // do it is always in this direction: an account exists in Firebase and
        // we have no row for it.
        //
        // Reaching here means no `users` row matched this phone number, so the
        // old code went straight to createUser — which Firebase REFUSES with
        // `auth/phone-number-already-exists` if it already knows the number.
        // The result is an account that can never sign in again, because every
        // future attempt takes this same branch and fails the same way.
        //
        // That is not an edge case. It happens to EVERY existing user the
        // moment the database is rebuilt or restored from before they signed
        // up — the platform has no Firebase->DB backfill (it was removed
        // deliberately), so the rows are gone while the Firebase accounts
        // remain. It also happens whenever a `users` row is deleted by hand.
        //
        // So: adopt the existing Firebase account instead of failing. This is
        // NOT the bulk sync that was removed — nothing is enumerated, and it
        // only ever runs for somebody who has just proved they control this
        // phone number by passing the OTP check above.
        let firebaseUserInfo;
        try {
          firebaseUserInfo = await userAuth.createUser({phoneNumber:`+91${data.mobile}`});
        } catch (createErr) {
          if (createErr?.code !== 'auth/phone-number-already-exists') throw createErr;
          firebaseUserInfo = await userAuth.getUserByPhoneNumber(`+91${data.mobile}`);
          console.log(`[verify-otp] adopting existing Firebase account ${firebaseUserInfo.uid} for +91${data.mobile} — no users row existed`);
        }
        const transaction = await db.transaction()
        try {
          // findOrCreate, not create: the lookup above matched on
          // contactNumber, so a row stored under this uid with the number in a
          // different shape (no +91, spaces) would collide on the primary key
          // and throw instead of signing the user in. Whatever is on the row
          // wins; this call only fills a gap.
          const [userInfo] = await User.findOrCreate({
            where: { id: firebaseUserInfo.uid },
            defaults: { id: firebaseUserInfo.uid, contactNumber: `+91${data.mobile}`, contactVerified: true },
            transaction,
          })
          // Same reasoning — an adopted account may already have a wallet.
          await Wallet.findOrCreate({ where: { userId: userInfo.id }, defaults: { userId: userInfo.id }, transaction })

          // A row reached through the uid was NOT seen by the contactNumber
          // lookup above, so it never passed that branch's suspension check.
          // Without this, storing the number in a different shape would be a
          // way for a suspended account to sign in — the one thing suspension
          // exists to stop.
          // Throw only — the catch below owns the rollback. Rolling back here
          // too would make Sequelize throw on the finished transaction and
          // replace this 403 with an unrelated 500.
          if (userInfo.verificationStatus === 'suspended') {
            throw new CustomError(
              userInfo.suspensionReason
                ? `Your account has been suspended: ${userInfo.suspensionReason}`
                : 'Your account has been suspended. Please contact support.',
              403,
            )
          }
          await transaction.commit()

          // The new account does NOT get a referral code yet — a code is minted
          // and switched on only when the user completes verification and
          // becomes active (userVerificationService.approve).
          //
          // If they signed up with someone's code, RECORD the referral now (in
          // its own transaction, so an invalid/self/expired code fails the
          // *referral*, never the *signup*). No points are credited here — the
          // sign-up reward is granted when this referee becomes an active user.
          if (data.referralCode) {
            try {
              await referralService.recordPendingReferral({
                refereeId: userInfo.id,
                code: data.referralCode,
              })
            } catch (referralErr) {
              console.log('[referral] signup code not applied:', referralErr?.message)
            }
          }

          let tokenInfo = await userAuth.createCustomToken(userInfo.id);

        return {user:userInfo,token:tokenInfo}
        } catch (err) {
          await transaction.rollback()
          throw err
        }
    }
  } catch (error) {
    // Handle errors appropriately (e.g., log the error, throw an exception)
    console.error('Error in precheck:', error);
    throw error;
  }
}


  async function getProfileInfo(userId) {
    try {
      // Check if the user with the given UID exists
      let user = await User.findOne({ where: { id: userId }, plain: true });
      
      let firebaseUserInfo = await userAuth.getUser(userId);

      const membership = await Membership.findOne({
        where: {
          userId: userId,
          status: MEMBERSHIP_SUBSCRIBED,
          endingTime: { [Op.gt]: new Date() } // Check if the end time is greater than the current time
        }
      });

      // Determine if the user has a premium membership and calculate the premium end date
      const isPremium = membership ? true : false;
      const premiumEndDate = isPremium ? membership.endTime : null;

      // Determine if the membership is renewable
      let isRenewable = false;
      if (membership) {
        const timeDifference = membership.endingTime - new Date();
        const daysDifference = timeDifference / (1000 * 3600 * 24);
        isRenewable = daysDifference <= 15;
      }

      const membershipInfo = membership ? membership.toJSON() : {};

      // Check if a wallet exists for the user, if not, create one
      let wallet = await Wallet.findOne({ where: { userId: userId }, plain: true });
      if (!wallet) {
        wallet = await Wallet.create({ userId: userId, name: user.name });
      }

      // Return the result
      return { 
        ...user.dataValues, 
        isPremium, 
        membership: { ...membershipInfo, isRenewable },
        wallet: wallet ? wallet.toJSON() : {}
      };
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }

// Resolves the Aadhaar number this OTP is about.
//
// The onboarding wizard confirms the number in its own step, and after that the
// client no longer holds it: it is handed back once at scan time and masked in
// every response since. So an omitted `kycNumber` is the NORMAL case for a
// client resuming the flow, not a malformed request — fall back to the number
// already settled on the user's current KYC row.
const resolveKycNumber = async (data, userId) => {
  const supplied = String(data?.kycNumber || '').replace(/[\s-]/g, '');
  if (supplied) return supplied;
  const doc = await documentStore.getCurrent('kyc', userId);
  const stored = String(doc?.documentNumber || '').replace(/[\s-]/g, '');
  if (!stored) {
    throw new CustomError('Confirm your Aadhaar number before requesting an OTP', 400, 'NO_AADHAAR_NUMBER');
  }
  return stored;
};

async function checkKycNumber(data, userId) {
    try {
      data = { ...data, kycNumber: await resolveKycNumber(data, userId) };
      // Uniqueness is checked against the document table, which is where
      // Aadhaar numbers live now.
      // The caller's OWN current row is excluded. Since the scan step now writes
      // the OCR-read number before the OTP is requested, the user's own draft
      // would otherwise match here and report their Aadhaar as belonging to
      // somebody else — blocking the very flow that wrote it.
      const clash = { documentNumber: data.kycNumber, isCurrent: true };
      if (userId) clash.userId = { [Op.ne]: userId };
      const existingDoc = await KycDocumentModel.findOne({ where: clash });
      if(existingDoc) throw new CustomError('Aadhar already linked with another account',400,'AADHAR_ALREADY_LINKED')
      let res  =  await axios.post(`${process.env.KYC_URL}/verification/offline-aadhaar/otp`,{aadhaar_number:data.kycNumber},{headers:{'x-client-id':`${process.env.KYC_ID}`,'x-client-secret':`${process.env.KYC_SECRET}`}})
      return {kycRef:res.data.ref_id}
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }

async function verifyKycNumber(data,userId) {
    try {
      // Same fallback as checkKycNumber — the OTP proves whichever number the
      // confirm step settled on, and the client is not required to still hold it.
      data = { ...data, kycNumber: await resolveKycNumber(data, userId) };
      let res  =  await axios.post(`${process.env.KYC_URL}/verification/offline-aadhaar/verify`,{ref_id:data.ref,otp:data.otp},{headers:{'x-client-id':`${process.env.KYC_ID}`,'x-client-secret':`${process.env.KYC_SECRET}`}})
      if(res.data.status !== 'VALID') throw(res.data.status)

      // The verified Aadhaar becomes the user's current KYC document. The
      // provider's name is captured here because it is what the KYC matching
      // rule compares the profile against.
      const existing = await documentStore.getCurrent('kyc', userId);
      await documentStore.submit('kyc', userId, {
        documentNumber: data.kycNumber,
        referenceId: data.ref,
        otpVerifiedAt: new Date(),
        holderName: res.data.name || res.data.name_as_per_aadhaar || existing?.holderName || null,
        // Carried over so verifying the OTP does not discard the scan step's
        // work — submit() creates a NEW row and drops anything not passed, and
        // the scans plus their OCR read now land BEFORE this call rather than
        // after it. Omitting these would erase the whole first half of the flow.
        imageKey: existing?.imageKey || null,
        backImageKey: existing?.backImageKey || null,
        ocrStatus: existing?.ocrStatus || null,
        ocrVerificationId: existing?.ocrVerificationId || null,
        ocrFields: existing?.ocrFields || null,
        ocrRaw: existing?.ocrRaw || null,
        ocrCheckedAt: existing?.ocrCheckedAt || null,
        // Set when the user typed the number because OCR could not read it —
        // their agreement to a human checking the card, and the admin's signal
        // that this row needs eyes even though the OTP passed.
        manualConsent: data.manualConsent === true || existing?.manualConsent || false,
        manualConsentAt: data.manualConsent === true
          ? (existing?.manualConsentAt || new Date())
          : (existing?.manualConsentAt || null),
        // OCR reads these off the card; the provider does not return them.
        dateOfBirth: existing?.dateOfBirth || null,
        gender: existing?.gender || null,
        address: existing?.address || null,
        providerStatus: res.data.status,
        providerCheckedAt: new Date(),
      });

      // The OTP is now the LAST step of Aadhaar capture — the scans go up before
      // it — so this is the point at which the document becomes complete. It is
      // what promotes `incomplete → pending` once the final document lands;
      // without it a user whose Aadhaar was the last outstanding item would sit
      // at `incomplete` forever with no submit button to find.
      await require('./userVerificationService').refreshAfterDocument(userId);

      return await documentStore.withUserDocuments(await User.findByPk(userId));
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }


  async function verifyKyc(userId) {
    try {
      const doc = await documentStore.getCurrent('kyc', userId);
      if (!doc) throw new CustomError('No KYC document on file', 404, 'NO_KYC_DOCUMENT');
      await doc.update({ status: 'verified', verifiedAt: new Date(), rejectionReason: null });
      return await documentStore.withUserDocuments(await User.findByPk(userId));
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }

async function getKycInformation(userId) {
    try {
      let user = await User.findOne({ where: { id: userId } });
      console.log('running')
      let res  =  await axios.get(`${process.env.KYC_URL}/verification/offline-aadhaar/${user.kycRef}`,{headers:{'x-client-id':process.env.KYC_ID,'x-client-secret':process.env.KYC_SECRET}})
      if(res.data.status !== 'VALID') throw(res.data.status)
    console.log('uer',user)
      return {user:user,kycInfo:res.data};
    } catch (error) {
      // Handle errors appropriately (e.g., log the error, throw an exception)
      console.error('Error in precheck:', error);
      throw error;
    }
  }

  async function getMyBookings(userId) {
    try {
      // Fetch transactions for the specific user along with related information
      const myBookings = await Booking.findAll({
        where: { userId ,status: { [Sequelize.Op.not]: BOOKING_INITIATED }},
        include: [
          {
            model: Transaction,
            as: 'transaction',
          },
          {
            model: Vehicle,
            as: 'vehicle',
            include:[
              {
                model: Image,
                as: 'images',
                attributes: ['url'],
              },
              {
                model: Brand,
                as: 'brand'
              },
            ]
          },
          {
            model: User,
            as: 'user',
          }
        ],
        order: [['startTime', 'DESC']], // Order by startTime in descending order
      });

      return myBookings;
    } catch (error) {
      console.error('Error fetching user bookings:', error);
      throw error;
    }
  }



  async function getMyPayments(userId) {
    try {
      // Fetch transactions for the specific user along with related information
      const myTransactions = await Transaction.findAll({
        where: { userId },
        order: [['startTime', 'DESC']], // Order by startTime in descending order
      });

      return myTransactions;
    } catch (error) {
      console.error('Error fetching user bookings:', error);
      throw error;
    }
  }


const updateInfo = async (updatedData,userId) => {
  try {
    const user = await User.findByPk(userId);

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    await user.update(updatedData);

    const updatedUser = await User.findByPk(userId);

    return { success: true, message: 'User updated successfully', user: updatedUser };
  } catch (error) {
    console.error('Error updating user:', error);
    return { success: false, message: 'Error updating user' };
  }
};

const updateProfileImage = async (updatedData,userId) => {
    let data = {}
    if(updatedData.profilePhoto) data.profilePhoto = updatedData.profilePhoto
    const user = await User.findByPk(userId);

    if (!user) {
      throw { success: false, message: 'User not found' };
    }
    await user.update(updatedData);

    const updatedUser = await User.findByPk(userId);

    return { success: true, message: 'User updated successfully', user: updatedUser };
};

const updateProfile = async (updatedData,userId) => {
    let data = {}
    if(updatedData.email) data.email = updatedData.email
    if(updatedData.name) data.name = updatedData.name
    if(updatedData.profilePhoto) data.profilePhoto = updatedData.profilePhoto
    const user = await User.findByPk(userId);

    if (!user) {
      throw { success: false, message: 'User not found' };
    }
    await user.update(updatedData);

    const updatedUser = await User.findByPk(userId);

    return { success: true, message: 'User updated successfully', user: updatedUser };
};


const updateKycInfo = async (updatedData,userId) => {
    const user = await User.findByPk(userId);
    if (!user) throw { success: false, message: 'User not found' };

    // The e-KYC reference must already exist — it is produced by the Aadhaar
    // OTP flow, not by this call.
    const existing = await documentStore.getCurrent('kyc', userId);
    const kycNumber = updatedData.kycNumber || existing?.documentNumber;
    const kycRef = updatedData.kycRef || existing?.referenceId;
    if (!kycNumber || !kycRef) {
      throw { success: false, message: 'KYC Number Not Verified' };
    }

    await documentStore.submit('kyc', userId, {
      documentNumber: kycNumber,
      referenceId: kycRef,
      holderName: updatedData.kycName || existing?.holderName || null,
      imageKey: updatedData.kycImage || existing?.imageKey || null,
      providerStatus: existing?.providerStatus || null,
      providerCheckedAt: existing?.providerCheckedAt || null,
    });

    // Completing a step that was skipped in the wizard queues the profile for
    // review on its own — the user shouldn't have to go back and re-submit.
    await require('./userVerificationService').refreshAfterDocument(userId);

    return { success: true, message: 'KYC details saved', user: await documentStore.withUserDocuments(await User.findByPk(userId)) };
};

const updateLicenseInfo = async (updatedData,userId) => {
    const user = await User.findByPk(userId);
    if (!user) throw { success: false, message: 'User not found' };

    const existing = await documentStore.getCurrent('licence', userId);

    // Carry forward whatever this submission doesn't replace, so uploading
    // only the back of a licence doesn't wipe the front.
    const doc = {
      licenceNumber: updatedData.licenseNumber || existing?.licenceNumber || null,
      holderName: updatedData.licenseName || existing?.holderName || null,
      frontImageKey: updatedData.licenseFrontImage || existing?.frontImageKey || null,
      backImageKey: updatedData.licenseBackImage || existing?.backImageKey || null,
      dateOfBirth: updatedData.licenseDob || existing?.dateOfBirth || null,
      expiryDate: updatedData.licenseExpiry || existing?.expiryDate || null,
    };

    // FR-3: extract the licence's details from the provider rather than
    // trusting what was typed. Needs the DOB the licence was issued against —
    // the profile's DOB is used when the client doesn't send one.
    const dobForCheck = updatedData.licenseDob || user.dateOfBirth;
    if (doc.licenceNumber && dobForCheck) {
      try {
        const result = await licenceVerification.verifyLicence({
          licenceNumber: doc.licenceNumber,
          dateOfBirth: dobForCheck,
          profileName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.name,
        });

        doc.providerStatus = result.status || null;
        doc.providerCheckedAt = new Date();

        // Extracted values WIN over typed ones — the whole point of extraction
        // is that the document is the source of truth, not the form.
        if (result.holderName) doc.holderName = result.holderName;
        if (result.dateOfBirth) doc.dateOfBirth = result.dateOfBirth;
        if (result.issuedDate) doc.issuedDate = result.issuedDate;
        if (result.expiryDate) doc.expiryDate = result.expiryDate;
      } catch (error) {
        // A malformed licence number is worth rejecting outright (it is a typo,
        // not a verification verdict). Anything else is advisory.
        if (error instanceof CustomError && error.statusCode === 400) throw error;
        console.error('[licence-verify] skipped:', error.message);
      }
    }

    await documentStore.submit('licence', userId, doc);

    await require('./userVerificationService').refreshAfterDocument(userId);

    return { success: true, message: 'Licence details saved', user: await documentStore.withUserDocuments(await User.findByPk(userId)) };
};

// PAN capture. Submitting a PAN never verifies it — panVerified is an admin
// decision made from the admin panel, exactly like KYC and licence.
const updatePanInfo = async (updatedData, userId) => {
    const user = await User.findByPk(userId);
    if (!user) throw { success: false, message: 'User not found' };

    const existing = await documentStore.getCurrent('pan', userId);
    const data = {};
    if (updatedData.panImage) data.imageKey = updatedData.panImage;
    if (updatedData.panName) data.holderName = String(updatedData.panName).trim();

    if (updatedData.panNumber) {
      const pan = String(updatedData.panNumber).toUpperCase().replace(/\s/g, '');
      // Fixed format: five letters, four digits, one letter. Checked here so an
      // obvious typo never reaches a human reviewer.
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
        throw { success: false, message: 'Invalid PAN — expected format ABCDE1234F' };
      }
      data.panNumber = pan;
    }

    if (!Object.keys(data).length) throw { success: false, message: 'Nothing to update' };

    // Carry forward anything this submission doesn't replace.
    data.panNumber = data.panNumber || existing?.panNumber || null;
    data.holderName = data.holderName || existing?.holderName || null;
    data.imageKey = data.imageKey || existing?.imageKey || null;

    // Ask the provider, using the same Cashfree credentials already used for
    // Aadhaar e-KYC and bank verification. The verdict is ADVISORY: it is
    // recorded and surfaced in the review queue, never used to reject — a
    // provider is wrong often enough (name formatting, stale records) that
    // blocking a real user on it costs more than a reviewer glancing at a flag.
    if (data.panNumber && process.env.KYC_URL && process.env.KYC_ID && process.env.KYC_SECRET) {
      try {
        const res = await axios.post(`${process.env.KYC_URL}/verification/pan`, {
          pan: data.panNumber,
          name: data.holderName || user.name,
        }, {
          headers: {
            'x-client-id': `${process.env.KYC_ID}`,
            'x-client-secret': `${process.env.KYC_SECRET}`,
          },
          timeout: 15000,
        });

        const provider = res.data || {};
        data.providerStatus = provider.status || (String(provider.valid) === 'false' ? 'INVALID' : 'VALID');
        data.providerName = provider.registered_name || null;
        data.providerCheckedAt = new Date();

        if (provider.registered_name) {
          const { compareNames } = require('./nameMatchService');
          const match = compareNames(user.name || data.holderName, provider.registered_name);
          data.nameMatch = match.matched;
          if (!match.matched) data.nameMismatchReason = match.reason;
        }
      } catch (error) {
        // An outage must not block onboarding. UNCHECKED is deliberately
        // distinct from INVALID — a reviewer needs to tell "the provider says
        // this is fake" from "we never got an answer".
        console.error('[pan-verify] provider call failed:', error.message);
        data.providerStatus = 'UNCHECKED';
      }
    }

    await documentStore.submit('pan', userId, data);
    return {
      success: true,
      message: 'PAN details saved',
      user: await documentStore.withUserDocuments(await User.findByPk(userId)),
    };
};

const updateMobile = async (updatedData,userId) => {
  try {
    const user = await User.findByPk(userId);

    if (!user) {
      return { success: false, message: 'User not found' };
    }

    let firebaseUserInfo = await userAuth.getUser(userId);
    if(firebaseUserInfo.phoneNumber) updatedData.contactNumber = firebaseUserInfo.phoneNumber;
    await user.update({contactNumber:firebaseUserInfo.phoneNumber,contactVerified:true});

    const updatedUser = await User.findByPk(userId);

    return { success: true, message: 'User Contact Number updated successfully', user: updatedUser };
  } catch (error) {
    console.error('Error updating user:', error);
    return { success: false, message: 'Error updating user Contact Number' };
  }
};

const getAllUsers = async ({search, sort, offset, cityId,isPremium,limit}) => {
  try {
    // Construct query based on parameters
    let queryOptions = {};
    if (search) {
      queryOptions.where = { [Op.or]: [
        { name: { [Op.like]: `%${search}%` } },
        { contactNumber: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        // Add more fields to search here
      ]};
    }
    if (sort) {
      const orderDirection = sort.startsWith('-') ? 'DESC' : 'ASC';
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort; // Remove the '-' for the field name
      queryOptions.order = [[sortField, orderDirection]];
    }
    if (offset) {
      queryOptions.offset = parseInt(offset);
    }
    if (limit) {
      queryOptions.limit = parseInt(limit);
    }
    // if (filters) {
      // Handle filters such as cityId and isPremium
      // if (cityId) {
      //   queryOptions.where = { ...queryOptions.where, cityId: cityId };
      // }
      if (isPremium) {
        // Assuming User has a relationship with Membership
        queryOptions.include = [{
          model: Membership,
          where: { isActive: true } // Assuming isActive field determines active membership
        }];
      }
      // Add more filters as needed
    // }

    // Query users with constructed options
    const users = await User.findAll(queryOptions);

    // Count total number of users (totalCount)
    const totalCount = await User.count(queryOptions);

    return { data: users, totalCount };
  } catch (error) {
    throw error instanceof CustomError ? error : new CustomError(`Error adding sample: ${error.message}`, 500, 'INTERNAL_ERROR');
  }
};


  module.exports = {precheck,getMyBookings,getMyPayments,getAllUsers,checkKycNumber,updateInfo,updateMobile,getProfileInfo,verifyKycNumber,getKycInformation,updateProfile,updateKycInfo,updateLicenseInfo,updatePanInfo,verifyKyc,updateProfileImage,sendOtp,verifyOtp}