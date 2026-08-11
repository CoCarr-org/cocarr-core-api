// API VERSIONING — how a breaking change ships without breaking old clients.
//
// URI versioning (`/v1/...`, `/v2/...`) rather than a header or media type, for
// three reasons that are specific to this platform:
//   - the gateway already routes by path prefix (`/v1/core`, `/v1/auth`), so a
//     new version is a routing-table entry rather than content negotiation at
//     the edge;
//   - the mobile clients are LONG-LIVED. An app installed today may still be
//     calling this service in two years, and a version you can see in a URL is
//     one you can find in an access log and count before you remove it;
//   - it is cacheable and greppable. A header-negotiated version is invisible
//     in every log and CDN key unless you remember to Vary on it.
//
// THE RULE THAT KEEPS THIS CHEAP: versions share services and models, and
// differ ONLY in their router and their serialisation. The moment v1 and v2
// have separate business logic you are maintaining two products, every bug
// gets fixed twice, and they drift. A version is a PRESENTATION contract.
//
// LIFECYCLE. Each version is `current`, `deprecated` or `sunset`:
//   current     the one new integrations should use
//   deprecated  still fully works; announces its removal date in headers
//   sunset      gone — 410, with a pointer to the replacement
//
// Deprecated responses carry RFC 9745 `Deprecation` and RFC 8594 `Sunset`
// headers plus a `Link` to the migration notes, so a client team can detect
// they are on borrowed time from their own monitoring rather than from an
// email nobody read.
const express = require('express');

// Registry. Adding a version = one entry + its router; nothing else in the
// service changes.
const VERSIONS = [
  {
    version: 'v1',
    status: 'current',
    router: () => require('./rootRouter'),
    // Set when the version is deprecated, not before — a sunset date with no
    // deprecation is a promise nobody has agreed to.
    sunsetAt: null,
    successor: null,
  },
  // Example of the shape a future version takes. Its router requires the same
  // services; only routes and response shaping differ.
  //
  // {
  //   version: 'v2',
  //   status: 'current',
  //   router: () => require('./v2/rootRouter'),
  //   sunsetAt: null,
  //   successor: null,
  // },
];

const DOCS_URL = process.env.API_DOCS_URL || 'https://github.com/CoCarr-org/cocarr-docs';

// Announce the lifecycle on every response of a deprecated version.
function deprecationHeaders(entry) {
  return (req, res, next) => {
    if (entry.status === 'deprecated') {
      // RFC 9745 — the version IS deprecated now.
      res.setHeader('Deprecation', 'true');
      if (entry.sunsetAt) {
        // RFC 8594 — an HTTP-date, not an ISO string; clients parse this.
        res.setHeader('Sunset', new Date(entry.sunsetAt).toUTCString());
      }
      res.setHeader('Link', `<${DOCS_URL}/API-VERSIONS.md>; rel="deprecation"`);
      if (entry.successor) res.setHeader('X-Api-Successor-Version', entry.successor);
    }
    next();
  };
}

// A sunset version answers 410 and NAMES its replacement. Returning 404 would
// be indistinguishable from a typo, and the caller would go looking for a bug
// in their own URL construction.
function goneHandler(entry) {
  return (req, res) => {
    res.status(410).json({
      error: {
        code: 'API_VERSION_SUNSET',
        message: `API ${entry.version} has been removed.`
          + (entry.successor ? ` Use ${entry.successor}.` : ''),
        documentation: `${DOCS_URL}/API-VERSIONS.md`,
      },
    });
  };
}

function mountVersions(app, { log = console } = {}) {
  VERSIONS.forEach((entry) => {
    const base = `/${entry.version}`;
    if (entry.status === 'sunset') {
      app.use(base, goneHandler(entry));
      log.info(`[api] ${entry.version} SUNSET — answering 410`);
      return;
    }
    app.use(base, deprecationHeaders(entry), entry.router());
    log.info(`[api] ${entry.version} mounted (${entry.status})`);
  });

  // Machine-readable inventory. A client team can poll this to discover it is
  // on a deprecated version without waiting to be told.
  app.get('/versions', (req, res) => {
    res.json({
      service: 'cocarr-core-api',
      versions: VERSIONS.map(({ version, status, sunsetAt, successor }) => ({
        version, status, sunsetAt, successor, path: `/${version}`,
      })),
    });
  });
}

module.exports = { VERSIONS, mountVersions };
