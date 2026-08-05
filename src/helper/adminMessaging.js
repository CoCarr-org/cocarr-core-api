const { initializeApp, getApps, getApp } = require('firebase-admin/app');
const { credential } = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');

// USER_SERVICE_ACCOUNT holds the Firebase service account, either as
// base64-encoded JSON (recommended for hosts that mangle multiline values)
// or as a raw JSON string.
const rawUserServiceAccount = process.env.USER_SERVICE_ACCOUNT || '';
const serviceAccount = JSON.parse(
  /^\s*\{/.test(rawUserServiceAccount)
    ? rawUserServiceAccount
    : Buffer.from(rawUserServiceAccount, 'base64').toString('utf8')
);

let app;
if (!getApp('user-app')) {
    app = initializeApp({
        credential: credential.cert({
            projectId: serviceAccount.project_id,
            private_key: serviceAccount.private_key,
            type: serviceAccount.type,
            clientEmail: serviceAccount.client_email,
            private_key_id: serviceAccount.private_key_id,
            client_id: serviceAccount.client_id,
            auth_uri: serviceAccount.auth_uri,
            token_uri: serviceAccount.token_uri,
            auth_provider_x509_cert_url: serviceAccount.auth_provider_x509_cert_url,
            client_x509_cert_url: serviceAccount.client_x509_cert_url,
            universe_domain: serviceAccount.universe_domain
        })
    }, 'user-app');
} else {
    app = getApp('user-app');
}

const adminMessaging = getMessaging(app);

module.exports = adminMessaging;