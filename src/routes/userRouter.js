// Import Express
const express = require('express');
const { authenticateUser, authenticateAdmin } = require('../middlewares/authMiddleware');
const userController = require('../controllers/userController');
const { check, body } = require('express-validator');
const router = express.Router()

router.post(
    '/precheck',
    authenticateUser,
    userController.precheck
    )
    router.get('/kyc-info',authenticateUser,()=>console.log('runnigng'));
    router.get('/',authenticateAdmin,userController.getAllUsers)
    router.post('/send-otp',userController.sendOtp)
    router.post('/verify-otp',userController.verifyOtp)

router.get(
  '/profile',
  [
    authenticateUser,
    // check('uid').notEmpty().withMessage('Login Id cannot be empty'),
  ],
  userController.getProfileInfo
);
router.post('/check-kyc',[authenticateUser,check('uid').notEmpty().withMessage('Login Id cannot be empty')],userController.checkKycNumber);
router.post('/verify-kyc',[authenticateUser,check('uid').notEmpty().withMessage('Login Id cannot be empty'),],userController.verifyKycNumber);
router.put(
  '/',
  authenticateUser,
  body('userId').notEmpty().withMessage('User Id cannot be empty'),
    body('email').optional().trim().isEmail().withMessage('Invalid Email address'),
    body('name').optional().trim().isLength({min:8,max:40}).withMessage('Name cannot be empty'),
    body('contactNumber').optional().trim().isLength({min:10,max:15}).withMessage('Email cannot be empty'),
    body('licenseNumber').optional().trim().isLength({min:5,max:40}).withMessage('Invalid License Number (Min 5 Chars.)'),
    body('kycNumber').optional().trim().isLength({min:5,max:40}).withMessage('Invalid KYC Number (Min 5 Chars.)'),
    userController.updateInfo
);
router.put(
  '/update-profile',
  authenticateUser,
  body('userId').notEmpty().withMessage('User Id cannot be empty'),
    body('email').optional().trim().isEmail().withMessage('Invalid Email address'),
    body('name').optional().trim().isLength({min:3,max:40}).withMessage('Name cannot be empty'),
    userController.updateProfile
);

router.put(
  '/update-photo',
  authenticateUser,
  body('profilePhoto').notEmpty().withMessage('Invalid Image'),
  userController.updateProfile
);

router.put(
  '/update-kyc',
  authenticateUser,
  body('userId').notEmpty().withMessage('User Id cannot be empty'),
  body('kycImage').optional().trim(),
    userController.updateKycInfo
);

router.put(
  '/update-license',
  authenticateUser,
  body('userId').notEmpty().withMessage('User Id cannot be empty'),
  body('licenseBackImage').trim(),
  body('licenseFrontImage').trim(),
    userController.updateLicenseInfo
);

// ── Onboarding & KYC verification (PRD: Signup & KYC) ──
router.get('/verification', authenticateUser, userController.getVerificationStatus);
router.put('/onboarding', authenticateUser, userController.saveOnboardingProfile);
router.post('/verification/submit', authenticateUser, userController.submitVerification);

// Document capture. Images arrive as base64 data URIs, which is why these have
// no multipart middleware — the selfie in particular is produced by a canvas on
// web and by the camera on mobile, neither of which has a File to post.
// Step 1 of Aadhaar capture: both faces in, OCR out. Deliberately does NOT
// require the OTP — it runs before it, and writes only an unproven draft row.
router.post('/verification/aadhaar/scan', authenticateUser, userController.scanAadhaar);
// Step 2 of Aadhaar capture, between the scan and the OTP: settles WHICH
// Aadhaar is about to be verified and hands back the details on file for it.
// Registered above the bare `/verification/aadhaar` below so neither shadows
// the other.
router.post('/verification/aadhaar/number', authenticateUser, userController.confirmAadhaarNumber);
// The licence follows the same two-call shape as Aadhaar: scan, then a number
// only when OCR could not read one.
router.post('/verification/licence/scan', authenticateUser, userController.scanLicence);
router.post('/verification/licence/number', authenticateUser, userController.confirmLicenceNumber);
// PAN capture mirrors the licence: scan the card, then a number only when OCR
// could not read one. Used by the host listing wizard's PAN step. Registered
// above the `:kind` retry route so the literal paths win.
router.post('/verification/pan/scan', authenticateUser, userController.scanPan);
router.post('/verification/pan/number', authenticateUser, userController.confirmPanNumber);
// Re-reads a scan already on file. This is what "retry verification" means — a
// failed read must not cost the user their photographs.
router.post('/verification/:kind(aadhaar|licence|pan)/retry-ocr', authenticateUser, userController.retryDocumentOcr);
// Legacy single-shot submits, kept for clients still on the OTP-first order.
// Registered AFTER the sub-paths above so neither swallows the other.
router.post('/verification/aadhaar', authenticateUser, userController.submitAadhaar);
router.post('/verification/licence', authenticateUser, userController.submitLicence);
router.post('/verification/selfie',  authenticateUser, userController.submitSelfie);

router.put(
  '/update-pan',
  authenticateUser,
  body('panNumber').optional().trim(),
  body('panName').optional().trim(),
  body('panImage').optional().trim(),
    userController.updatePanInfo
);

router.put(
  '/update-mobile',
  [
    authenticateUser,
    check('uid').notEmpty().withMessage('User Id cannot be empty'),
  ],
  userController.updateMobile
);
router.get('/rides',authenticateUser,userController.getMyBookings);
router.get('/payments',authenticateUser,userController.getMyPayments);

module.exports = router;