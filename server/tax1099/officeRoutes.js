"use strict";

/**
 * Tax1099 Phase 2A -- internal, office-only SANDBOX verification routes.
 *
 * Purpose: let an authenticated office user (1) connect this app to the
 * Tax1099 SANDBOX through the existing OAuth Authorization Code + PKCE
 * helper and (2) run the existing read-only sandbox pricing check.
 *
 * Fail-closed registration: NO route is registered (every path 404s) unless
 *   - TAX1099_ENABLED=true,
 *   - TAX1099_ENV is sandbox, and
 *   - this deployment is not a production host (APP_ENV, RENDER, NODE_ENV).
 * Outbound calls additionally require TAX1099_NETWORK_ENABLED=true (enforced
 * by config.assertNetworkAllowed() inside auth.js / client.js).
 *
 * Every action route requires BOTH:
 *   - a valid office session (the app's existing requireOfficeDocumentReviewApi
 *     middleware, passed in by server.js), and
 *   - a server-side authorization value: the X-Tax1099-Verification-Key
 *     header must equal TAX1099_OFFICE_VERIFICATION_KEY (>= 32 chars) from
 *     trusted server configuration. The expected value is NEVER read from the
 *     request body or query string. Unset key => every action is refused.
 *
 * CSRF: actions are POST-only; the office cookie is SameSite=Strict (not sent
 * on cross-site requests) and the custom header forces a CORS preflight.
 * The OAuth callback is a GET redirect from Tax1099 (a cross-site navigation,
 * so the SameSite=Strict office cookie is intentionally absent); it is
 * protected instead by the one-time, 10-minute PKCE/CSRF `state` that only
 * the office-authenticated /oauth/start action can create.
 *
 * Never returned or logged: access/refresh tokens, authorization codes, PKCE
 * verifiers, client secrets, or the verification key. No payer, recipient,
 * TIN, form, filing, Stripe, or customer-record operation exists here.
 */

const crypto = require("node:crypto");
const config = require("./config");
const auth = require("./auth");
const { verifySandboxPricing } = require("./pricingVerification");

const ROUTE_BASE = "/api/office/tax1099/sandbox";
const CALLBACK_PATH = `${ROUTE_BASE}/oauth/callback`;
const VERIFICATION_HEADER = "x-tax1099-verification-key";
// One shared in-memory sandbox session for the office (single office role).
const OFFICE_SANDBOX_SESSION_KEY = "office-sandbox-verification";
const MIN_VERIFICATION_KEY_LENGTH = 32;

function readServerVerificationKey() {
  const value = process.env.TAX1099_OFFICE_VERIFICATION_KEY;
  return typeof value === "string" ? value.trim() : "";
}

function routesAllowed() {
  return (
    config.TAX1099_ENABLED === true &&
    config.IS_SANDBOX === true &&
    config.APP_ENV !== "production"
  );
}

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

// Server-side authorization gate. Expected value comes only from server
// configuration; the supplied value only from a request header.
function requireServerAuthorization(req, res, next) {
  noStore(res);
  const expected = readServerVerificationKey();
  const supplied = String(req.get(VERIFICATION_HEADER) || "");

  const ok =
    expected.length >= MIN_VERIFICATION_KEY_LENGTH &&
    supplied.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));

  if (!ok) {
    return res.status(403).json({
      ok: false,
      error: "Tax1099 sandbox verification is not authorized."
    });
  }

  req.tax1099VerificationKey = supplied;
  return next();
}

// Maps internal errors to fixed, non-sensitive responses. Raw error
// messages and vendor bodies are never passed through.
const ERROR_RESPONSES = {
  TAX1099_DISABLED: [503, "The Tax1099 integration is disabled."],
  TAX1099_NETWORK_DISABLED: [503, "Tax1099 network access is disabled."],
  TAX1099_PRODUCTION_BLOCKED: [403, "Tax1099 production mode is blocked."],
  TAX1099_ENDPOINT_MISSING: [503, "A required Tax1099 sandbox endpoint is not configured."],
  TAX1099_ENDPOINT_INVALID: [503, "A configured Tax1099 endpoint is invalid."],
  TAX1099_ENDPOINT_NOT_PERMITTED: [503, "A configured Tax1099 endpoint is not a permitted sandbox destination."],
  TAX1099_CREDENTIAL_MISSING: [503, "Tax1099 sandbox credentials are not configured."],
  TAX1099_REDIRECT_MISSING: [503, "The Tax1099 sandbox redirect URI is not configured."],
  TAX1099_NOT_AUTHENTICATED: [409, "Connect the Tax1099 sandbox account first."],
  TAX1099_TOKEN_REQUEST_FAILED: [502, "Tax1099 sandbox sign-in could not be completed."],
  TAX1099_API_REQUEST_FAILED: [502, "The Tax1099 sandbox pricing request failed."]
};

function sendSafeError(res, err, fallbackStatus = 502) {
  const code = err && typeof err.code === "string" ? err.code : "";
  const [status, message] =
    ERROR_RESPONSES[code] || [fallbackStatus, "The Tax1099 sandbox request could not be completed."];
  const body = { ok: false, error: message, code: code || "TAX1099_REQUEST_FAILED" };
  if (code === "TAX1099_API_REQUEST_FAILED" && Number.isInteger(err.status)) {
    body.vendorStatus = err.status;
  }
  return res.status(status).json(body);
}

function logFailure(logger, action, err) {
  // Codes and statuses only -- never messages, bodies, URLs, or tokens.
  const code = err && typeof err.code === "string" ? err.code : "UNCLASSIFIED";
  const status = err && Number.isInteger(err.status) ? ` status ${err.status}` : "";
  logger.error(`[tax1099 sandbox] ${action} failed: ${code}${status}`);
}

function callbackPage(res, status, title, message) {
  noStore(res);
  res.status(status).type("html").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="robots" content="noindex,nofollow"><title>${title}</title></head>` +
      `<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`
  );
}

function registerTax1099OfficeRoutes(app, { requireOfficeApi, logger = console } = {}) {
  if (typeof requireOfficeApi !== "function") {
    throw new Error("registerTax1099OfficeRoutes requires the office authentication middleware.");
  }

  if (!routesAllowed()) {
    return { registered: false };
  }

  // Readiness snapshot: flags and presence booleans only.
  app.post(`${ROUTE_BASE}/status`, requireOfficeApi, requireServerAuthorization, (req, res) => {
    const session = auth.getSessionStatus(OFFICE_SANDBOX_SESSION_KEY);
    return res.status(200).json({
      ok: true,
      sandbox: config.IS_SANDBOX,
      networkEnabled: config.TAX1099_NETWORK_ENABLED,
      configured: config.credentialPresence(),
      session: {
        authenticated: Boolean(session.authenticated),
        hasRefreshToken: Boolean(session.hasRefreshToken),
        expired: Boolean(session.expired)
      }
    });
  });

  // Step 1: office starts the sandbox OAuth connection. Returns the
  // authorization URL to open; it carries only the public client id,
  // redirect URI, PKCE challenge, and one-time state.
  app.post(`${ROUTE_BASE}/oauth/start`, requireOfficeApi, requireServerAuthorization, (req, res) => {
    try {
      config.assertNetworkAllowed();
      const { authorizationUrl } = auth.createAuthorizationRequest();
      return res.status(200).json({ ok: true, authorizationUrl });
    } catch (err) {
      logFailure(logger, "oauth start", err);
      return sendSafeError(res, err, 503);
    }
  });

  // Step 2: Tax1099 redirects back here. Protected by the one-time state.
  app.get(CALLBACK_PATH, async (req, res) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";

    if (req.query.error) {
      // Consume the state so it cannot be replayed; do not echo vendor text.
      if (state) auth.consumeState(state);
      return callbackPage(res, 400, "Tax1099 sandbox connection was not completed",
        "Tax1099 did not authorize the connection. Start again from the office tools.");
    }

    const codeVerifier = auth.consumeState(state);
    if (!codeVerifier || !code) {
      return callbackPage(res, 400, "Tax1099 sandbox connection was not completed",
        "This sign-in link is invalid or has expired. Start again from the office tools.");
    }

    try {
      await auth.exchangeCodeForTokens({
        code,
        codeVerifier,
        sessionKey: OFFICE_SANDBOX_SESSION_KEY
      });
      return callbackPage(res, 200, "Tax1099 sandbox connected",
        "The sandbox connection is active for this server process. You can close this page.");
    } catch (err) {
      logFailure(logger, "oauth callback", err);
      return callbackPage(res, 502, "Tax1099 sandbox connection was not completed",
        "The sandbox sign-in could not be completed. Start again from the office tools.");
    }
  });

  // Step 3: read-only sandbox pricing check (GET /api/v1/Common/GetFlatPricing
  // via the existing allowlisted client; redirects refused).
  app.post(`${ROUTE_BASE}/pricing-verification`, requireOfficeApi, requireServerAuthorization, async (req, res) => {
    try {
      const pricing = await verifySandboxPricing({
        sessionKey: OFFICE_SANDBOX_SESSION_KEY,
        authorization: req.tax1099VerificationKey,
        expectedAuthorization: readServerVerificationKey()
      });
      return res.status(200).json({ ok: true, sandbox: true, pricing });
    } catch (err) {
      logFailure(logger, "pricing verification", err);
      return sendSafeError(res, err);
    }
  });

  return { registered: true, routeBase: ROUTE_BASE, callbackPath: CALLBACK_PATH };
}

module.exports = {
  registerTax1099OfficeRoutes,
  ROUTE_BASE,
  CALLBACK_PATH,
  VERIFICATION_HEADER,
  // exported for tests
  _internal: { routesAllowed, OFFICE_SANDBOX_SESSION_KEY }
};
