const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Cashfree's verification (Secure ID) APIs enforce an IP allowlist per account,
// and this service's outbound IP is not stable — on Railway it has rotated
// repeatedly (34.158.47.241 → 34.177.106.40 → 34.158.61.200), so whitelisting
// the current address never holds for long.
//
// Setting KYC_PROXY_URL routes ONLY the KYC calls through a proxy that owns a
// fixed IP; that single address is what gets whitelisted in Cashfree. Everything
// else in the app keeps going out directly.
//
//   KYC_PROXY_URL=http://user:pass@proxy-host:port
//
// When the variable is unset this is a plain axios instance, so behaviour is
// unchanged until you opt in.
const proxyUrl = process.env.KYC_PROXY_URL;

let agent;
if (proxyUrl) {
  try {
    // Validate BEFORE building the agent, so a bad value can't leave a
    // half-configured agent behind and silently break every KYC call.
    const parsed = new URL(proxyUrl);
    agent = new HttpsProxyAgent(proxyUrl);
    // Log the host only — the URL can embed credentials.
    console.log('[KYC] Routing KYC calls through proxy:', parsed.host);
  } catch (error) {
    agent = undefined;
    console.error('[KYC] Invalid KYC_PROXY_URL, sending KYC calls directly:', error.message);
  }
}

const kycHttp = axios.create(
  agent
    // `proxy: false` stops axios doing its own proxy handling and fighting the agent.
    ? { httpsAgent: agent, httpProxyAgent: agent, proxy: false, timeout: 30000 }
    : { timeout: 30000 }
);

// True when KYC traffic is pinned to a fixed egress IP.
const isKycProxied = () => !!agent;

// Logs the outbound IP that Cashfree (and any other third party) sees for this
// server — i.e. the address that would need whitelisting. Uses the same client
// as the KYC calls, so with KYC_PROXY_URL set it reports the PROXY's IP rather
// than the container's. Best-effort: never throws, never blocks startup.
const logOutboundIp = async () => {
  try {
    const { data } = await kycHttp.get('https://api.ipify.org?format=json', { timeout: 8000 });
    const ip = typeof data === 'string' ? data.trim() : data?.ip;
    console.log(
      `[KYC] Outbound IP: ${ip}${agent ? ' (via proxy)' : ' (direct)'}` +
      ' — this is the address to whitelist with Cashfree.'
    );
    return ip;
  } catch (error) {
    console.log('[KYC] Could not determine outbound IP:', error.message);
    return null;
  }
};

module.exports = { kycHttp, isKycProxied, logOutboundIp };
