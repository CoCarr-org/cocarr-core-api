// const { initializeApp } = require('firebase-admin/app');
// const { getAuth } = require('firebase-admin/auth');


// function verifyFirebaseToken(req, res, next) {
//     initializeApp();
//     const idToken = req.header('Authorization');
  
//     if (!idToken) {
//       return res.status(401).json({ error: 'Unauthorized' });
//     }
    

// const auth = getAuth();

// auth.verifyIdToken(idToken)
//     .then((decodedToken) => {
//       // Attach user information to the request object for use in route handlers
//       req.user = decodedToken;
//       next();
//     })
//     .catch((error) => {
//       console.error('Error verifying Firebase token:', error);
//       res.status(401).json({ error: 'Unauthorized' });
//     });
// }

const adminAuth = require('../helper/adminAuth');
const userAuth = require('../helper/userAuth');
const Admin = require('../models/admin');
const User = require('../models/user');
const AdminTeam = require('../models/adminTeam');
const adminPanels = require('../utils/adminPanels');
const { BOOTSTRAP_EMAIL } = require('../services/bootstrapAdminService');

const authenticateAdmin = async (req, res, next) => {
  try {
    let idToken = req.headers.authorization;

    // DO NOT LOG THE TOKEN. This printed the full bearer JWT on EVERY admin
    // request — a live credential, in plaintext, in a log anyone with log
    // access can read and replay until it expires. It is all over the current
    // Railway logs for this service. The uid is what makes a log line useful
    // for attribution, and it is already attached to `req.adminUid` below.

    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized - Missing Authorization Header' });
    }

    // Remove 'Bearer ' prefix if present
    if (idToken.startsWith('Bearer ')) {
      idToken = idToken.slice(7).trim();
    }

    const decodedToken = await adminAuth.verifyIdToken(idToken);

    // A valid Firebase token alone used to be enough — deactivating someone
    // in Access Control (isActive=false) had no actual effect. Only deny when
    // we have an explicit record saying so; an admin with no `admins` row yet
    // (e.g. sync hasn't run) is left unaffected rather than newly locked out.
    const admin = await Admin.findOne({ where: { uid: decodedToken.uid } });
    if (admin && admin.isActive === false) {
      return res.status(403).json({ error: 'Forbidden - Admin access has been deactivated' });
    }

    // Available to any route for activity-log attribution ("who did this") —
    // may be null if the admin has no `admins` row yet (see comment above).
    req.admin = admin;
    req.adminUid = decodedToken.uid;

    // ── Panel binding ──
    // Which admin site did this request come from, and may this admin's team use
    // it? Checked per REQUEST, not at sign-in: every panel shares one Firebase
    // project and one API, so a token minted at the portal is a valid token at
    // the console. A sign-in check would be checked once and bypassed for the
    // rest of the session.
    //
    // OFF until ADMIN_PANEL_ORIGINS / ADMIN_PANEL_KEYS are set, so merging this
    // cannot reject traffic from the single admin panel running today.
    //
    // A SECOND control, not the first: the permission grid still refuses a
    // support agent anything useful even if they reach the console API. This
    // stops them using the console UI at all.
    if (adminPanels.isConfigured()) {
      // Break-glass. The bootstrap account must reach the console even if the
      // panel config is wrong — that is the entire point of it.
      const isBootstrap = (admin?.email || '').toLowerCase() === BOOTSTRAP_EMAIL;
      if (!isBootstrap) {
        let teamKey = null;
        if (admin?.teamId) {
          const team = await AdminTeam.findByPk(admin.teamId);
          teamKey = team ? team.key : null;
        }
        const verdict = adminPanels.check(req, teamKey);
        if (!verdict.allowed) {
          console.warn(`[panel] DENIED ${admin?.email || decodedToken.uid} -> ${req.method} ${req.originalUrl}: ${verdict.reason}`);
          // `code` so the login screen can tell a wrong-panel sign-in (sign them
          // straight back out and say where to go) from every other 403, which
          // the boot gate handles with its own state. String-matching the
          // message for that would break the moment the wording is edited.
          return res.status(403).json({ error: verdict.reason, code: 'panel_denied' });
        }
        req.adminPanel = verdict.panel;
      }
    }

    next();
  } catch (error) {
    console.error('Error authenticating admin:', error);
    return res.status(401).json({ error: 'Unauthorized - Invalid Token' });
  }
};

const authenticateUser = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization;
    // console.log('idToken',idToken)
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized - Missing Authorization Header' });
    }

    const decodedToken = await userAuth.verifyIdToken(idToken);

    // A suspended account must lose access immediately, not whenever its
    // Firebase token happens to expire. Blocking only at sign-in would leave
    // anyone already signed in with up to an hour of full access after being
    // suspended, so the check belongs on every request.
    //
    // Only an explicit `suspended` row denies — a valid token with no `users`
    // row yet (the row is created at verify-otp) passes through, exactly like
    // the admin path above.
    const user = await User.findByPk(decodedToken.uid, {
      attributes: ['id', 'verificationStatus', 'suspensionReason'],
    });
    if (user && user.verificationStatus === 'suspended') {
      return res.status(403).json({
        error: 'Your account has been suspended',
        reason: user.suspensionReason || null,
        suspended: true,
      });
    }

    req.userId = decodedToken.uid;
    req.body.userId = decodedToken.uid;
    // Saves every downstream service a re-read just to check the gate.
    req.userStatus = user ? user.verificationStatus : null;
    next();
  } catch (error) {
    console.error('Error authenticating user:', error);
    return res.status(401).json({ error: 'Unauthorized - Invalid Token' });
  }
};


const authenticateUserOptional = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization;
    if (idToken) {
      const decodedToken = await userAuth.verifyIdToken(idToken);
      req.userId = decodedToken.uid;
      req.body.userId = decodedToken.uid;
    }
    next();

  } catch (error) {
    console.error('Error authenticating user:', error);
    return res.status(401).json({ error: 'Unauthorized - Invalid Token' });
  }
};

module.exports = {
  authenticateAdmin,
  authenticateUser,
  authenticateUserOptional
};


// module.exports = verifyFirebaseToken;