const {initializeApp, cert } = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');

// ADMIN_SERVICE_ACCOUNT holds the Firebase service account, either as
// base64-encoded JSON (recommended for hosts that mangle multiline values)
// or as a raw JSON string.
const rawAdminServiceAccount = process.env.ADMIN_SERVICE_ACCOUNT || '';
const serviceAccount = JSON.parse(
  /^\s*\{/.test(rawAdminServiceAccount)
    ? rawAdminServiceAccount
    : Buffer.from(rawAdminServiceAccount, 'base64').toString('utf8')
);
const app = initializeApp({credential:cert({projectId:serviceAccount.project_id,private_key:serviceAccount.private_key,type:serviceAccount.type,clientEmail:serviceAccount.client_email,type:serviceAccount.type,private_key_id:serviceAccount.private_key_id,client_id:serviceAccount.client_id,auth_uri:serviceAccount.auth_uri,token_uri:serviceAccount.token_uri,auth_provider_x509_cert_url:serviceAccount.auth_provider_x509_cert_url,client_x509_cert_url:serviceAccount.client_x509_cert_url,universe_domain:serviceAccount.universe_domain})},'admin-app');
const adminAuth = getAuth(app);

module.exports = adminAuth;// firebase-admin v14 REMOVED the legacy `credential` namespace from the
// package root: `require('firebase-admin').credential` is now undefined, so
// `credential.cert(...)` threw "Cannot read properties of undefined (reading
// 'cert')" at module load — before the server could listen, which Railway saw
// only as a healthcheck timeout. `cert` comes from 'firebase-admin/app', the
// same modular entry point this file already imports initializeApp from.

