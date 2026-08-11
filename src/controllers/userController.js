const express = require('express');
const router = express.Router();
const UserService = require('../services/userService'); // Import your Sequelize User Model
const { validationResult } = require('express-validator');

// Route to retrieve all users
const precheck = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const newUser = await UserService.precheck(req.userId);
    return res.status(201).json(newUser);
  } catch (error) {
    console.log(error)
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// Both OTP handlers used to log "Error fetching user bookings" (copy-paste) and
// answer every failure with a hardcoded 500 — so a deliberate 400 like
// "Mobile no. already verified" reached the app as an opaque server error.
// Passing the error on lets errorHandlerMiddleware preserve status + code.
async function sendOtp(req, res, next) {
  try {
    const result = await UserService.sendOtp(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error sending OTP:', error);
    next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const result = await UserService.verifyOtp(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error verifying OTP:', error);
    next(error);
  }
}

const getProfileInfo = async (req, res) => {
  // Validate and sanitize input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const newUser = await UserService.getProfileInfo(req.userId);
    return res.status(201).json(newUser);
  } catch (error) {
    console.log(error)
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};


async function getMyBookings(req, res) {
  // const { userId } = req.params;

  try {
    const myBookings = await UserService.getMyBookings(req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function getMyPayments(req, res) {
  // const { userId } = req.params;

  try {
    const myBookings = await UserService.getMyPayments(req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function updateInfo(req, res) {
  // const { userId } = req.params;

  try {
    const errors = validationResult(req);
    if(errors) throw errors;
    const myBookings = await UserService.updateInfo(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json(error);
  }
}

async function updateProfile(req, res) {
  // const { userId } = req.params;

  try {
    const errors = validationResult(req);
    if(errors.length>0) throw errors;
    const myBookings = await UserService.updateProfile(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json(error);
  }
}


async function updateKycInfo(req, res) {
  // const { userId } = req.params;

  try {
    const errors = validationResult(req);
    if(errors.length>0) throw errors;
    const myBookings = await UserService.updateKycInfo(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
}

async function updateLicenseInfo(req, res) {
  // const { userId } = req.params;

  try {
    const errors = validationResult(req);
    if(errors.length>0) throw errors;
    const myBookings = await UserService.updateLicenseInfo(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json(error);
  }
}

async function checkKycNumber(req, res) {
  // const { userId } = req.params;

  try {
    const myBookings = await UserService.checkKycNumber(req.body, req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json(error);
  }
}

async function verifyKycNumber(req, res) {
  // const { userId } = req.params;

  try {
    const myBookings = await UserService.verifyKycNumber(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function getKycInformation(req, res) {

  try {
    console.log('controller')
    const info = await UserService.getKycInformation(req.userId);

    res.status(200).json(info);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: error });
  }
}

const userVerification = require('../services/userVerificationService');

const verificationHandler = (fn) => async (req, res) => {
  try {
    res.status(200).json(await fn(req));
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[verification]', error);
    // `needsConsent` means OCR could not read the document. The client shows a
    // consent prompt rather than a plain error, so the flag has to survive the
    // trip — a bare {error} would make an outage look like a rejected document.
    const body = { error: error.message };
    if (error.needsConsent) {
      body.needsConsent = true;
      body.ocrStatus = error.ocrStatus || null;
    }
    // Tells the client to send the user back to the OTP step rather than showing
    // a dead-end error.
    if (error.needsOtp) body.needsOtp = true;
    // Send the user back to the document upload, or ask for the number the
    // photo did not yield. Same idea as the two above: an error the client can
    // route on beats an error it can only display.
    if (error.needsScan) body.needsScan = true;
    if (error.needsNumber) body.needsNumber = true;
    res.status(status).json(body);
  }
};

const saveOnboardingProfile = verificationHandler((req) => userVerification.saveProfile(req.userId, req.body));
const getVerificationStatus = verificationHandler((req) => userVerification.getStatus(req.userId));
const submitVerification = verificationHandler((req) => userVerification.submitForReview(req.userId));

// Onboarding document capture — Aadhaar, licence and the live selfie.
const onboardingDocs = require('../services/onboardingDocumentService');
const scanAadhaar = verificationHandler((req) => onboardingDocs.scanAadhaar(req.userId, req.body));
const confirmAadhaarNumber = verificationHandler((req) => onboardingDocs.confirmAadhaarNumber(req.userId, req.body));
const scanLicence = verificationHandler((req) => onboardingDocs.scanLicence(req.userId, req.body));
const confirmLicenceNumber = verificationHandler((req) => onboardingDocs.confirmLicenceNumber(req.userId, req.body));
// PAN follows the same scan → confirm-number shape as the licence, so a host can
// verify their PAN inside the listing wizard the way KYC works during signup.
const scanPan = verificationHandler((req) => onboardingDocs.scanPan(req.userId, req.body));
const confirmPanNumber = verificationHandler((req) => onboardingDocs.confirmPanNumber(req.userId, req.body));
// One handler for every scanned document — the kind is the route, not the
// payload, so a client cannot ask us to OCR something we do not scan.
const retryDocumentOcr = verificationHandler((req) => onboardingDocs.retryDocumentOcr(req.userId, req.params.kind));
const submitAadhaar = verificationHandler((req) => onboardingDocs.submitAadhaar(req.userId, req.body));
const submitLicence = verificationHandler((req) => onboardingDocs.submitLicence(req.userId, req.body));
const submitSelfie = verificationHandler((req) => onboardingDocs.submitSelfie(req.userId, req.body));

async function updatePanInfo(req, res) {
  try {
    const result = await UserService.updatePanInfo(req.body, req.userId);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error updating PAN:', error);
    res.status(400).json(error?.message ? { error: error.message } : error);
  }
}

async function updateMobile(req, res) {
  // const { userId } = req.params;

  try {
    const myBookings = await UserService.updateMobile(req.body,req.userId);

    res.status(200).json(myBookings);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function getAllUsers(req, res) {

  try {
    const {search, sort, offset, cityId,isPremium,limit} = req.query
    const users = await UserService.getAllUsers({search, sort, offset, cityId,isPremium,limit});

    res.status(200).json(users);
  } catch (error) {
    console.error('Error fetching user bookings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

module.exports = {precheck,getMyBookings,getMyPayments,getAllUsers,updateInfo,updateMobile,getProfileInfo,verifyKycNumber,checkKycNumber,getKycInformation,updateProfile,updateKycInfo,updateLicenseInfo,
  updatePanInfo,
  saveOnboardingProfile,
  getVerificationStatus,
  submitVerification,
  scanAadhaar, confirmAadhaarNumber,
  scanLicence, confirmLicenceNumber, retryDocumentOcr,
  scanPan, confirmPanNumber,
  submitAadhaar, submitLicence, submitSelfie,
  sendOtp,verifyOtp};