const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Cashfree Two-Factor Authentication (2FA) signature: clientId.timestamp,
// RSA-encrypted with the account public key (OAEP, matching Cashfree's PHP
// sample), sent as x-cf-signature ALONGSIDE x-client-secret. With 2FA enabled
// on the account, requests authenticate cryptographically and IP whitelisting
// is not required — which is what makes a rotating egress IP survivable.
//
// Key resolution order:
//   1. KYC_PUBLIC_KEY       — full PEM (literal \n escapes supported)
//   2. KYC_PUBLIC_KEY_PATH  — path to a .pem file
//   3. <repo root>/accountId_61985_public_key.pem (committed with the code)
const DEFAULT_KEY_FILE = "accountId_61985_public_key.pem";

let cachedKey;
let resolved = false;

function loadPublicKey() {
    if (resolved) return cachedKey;
    resolved = true;

    if (process.env.KYC_PUBLIC_KEY) {
        cachedKey = process.env.KYC_PUBLIC_KEY.replace(/\\n/g, "\n");
        return cachedKey;
    }

    const candidates = [
        process.env.KYC_PUBLIC_KEY_PATH,
        path.join(process.cwd(), DEFAULT_KEY_FILE),
        path.join(__dirname, "..", "..", DEFAULT_KEY_FILE),
    ].filter(Boolean);

    for (const file of candidates) {
        try {
            if (fs.existsSync(file)) {
                cachedKey = fs.readFileSync(file, "utf8");
                console.log("[KYC] Cashfree public key loaded from", file);
                return cachedKey;
            }
        } catch (error) {
            console.error("[KYC] Could not read public key at", file, "-", error.message);
        }
    }

    console.error(
        "[KYC] No Cashfree public key found — x-cf-signature will be omitted.",
        "\n  → Commit", DEFAULT_KEY_FILE, "to the repo root, or set KYC_PUBLIC_KEY / KYC_PUBLIC_KEY_PATH."
    );
    cachedKey = null;
    return cachedKey;
}

// Returns the base64 signature, or null when it can't be produced. Returning
// null instead of throwing lets the caller fall back to secret-only auth and
// surface Cashfree's own error rather than crashing the request.
function getSignature() {
    const clientId = process.env.KYC_ID;
    const publicKey = loadPublicKey();
    if (!clientId || !publicKey) return null;

    try {
        // Same as PHP: clientId.timestamp
        const encodedData = `${clientId}.${Math.floor(Date.now() / 1000)}`;
        return encryptRSA(encodedData, publicKey);
    } catch (error) {
        console.error("[KYC] Failed to generate x-cf-signature:", error.message);
        return null;
    }
}

function encryptRSA(plainData, publicKey) {
    const encrypted = crypto.publicEncrypt(
        {
            key: publicKey,
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        },
        Buffer.from(plainData, "utf8")
    );

    return encrypted.toString("base64");
}

module.exports = {
    getSignature,
};
