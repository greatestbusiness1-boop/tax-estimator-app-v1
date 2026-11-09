"use strict";

/**
 * Tax1099 OAuth (Authorization Code + PKCE, S256) helper.
 *
 * Scope of this module: authentication only. It builds the authorization
 * request (with PKCE and CSRF state), verifies the callback, exchanges an
 * authorization code for tokens, and can refresh an access token. It does
 * not create payers/recipients, does not submit forms, and never logs an
 * authorization code, access token, or refresh token.
 */

const crypto = require("crypto");
const config = require("./config");

const PENDING_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete the OAuth round trip
const pendingStates = new Map(); // state -> { codeVerifier, createdAt }

// Ephemeral, in-process token storage for staging authentication testing
// only. Tokens do not survive a restart and are never written to disk,
// Supabase, or any log. This is intentionally NOT a production-grade token
// store -- a real integration needs encrypted-at-rest persistence scoped to
// the authenticated account, which is out of scope for "authentication
// only" (Phase 1B-3).
const tokenStore = new Map(); // key -> { accessToken, refreshToken, tokenType, expiresAt, obtainedAt }

function base64url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeVerifier() {
  // RFC 7636: 43-128 characters from the unreserved URL-safe alphabet.
  // 64 random bytes -> 86-character base64url string, well within range.
  return base64url(crypto.randomBytes(64));
}

function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64url(hash);
}

function generateState() {
  return base64url(crypto.randomBytes(32));
}

/**
 * Builds the HTTP Basic client-authentication header value Tax1099's
 * token endpoint requires: `Basic base64(client_id:client_secret)`. Never
 * logged, printed, or returned from any exported function -- it exists
 * only to be attached directly to the outgoing fetch() call.
 */
function buildBasicAuthHeader(clientId, clientSecret) {
  const credential = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return `Basic ${credential}`;
}

function cleanupExpiredStates(now = Date.now()) {
  for (const [state, entry] of pendingStates.entries()) {
    if (now - entry.createdAt > PENDING_STATE_TTL_MS) {
      pendingStates.delete(state);
    }
  }
}

/**
 * Builds a fresh authorization request: PKCE verifier/challenge, CSRF
 * state, and the full authorization URL to redirect the user to. The
 * state + verifier pair is held in memory until consumeState() is called
 * (or it expires) -- the verifier itself is never sent to Tax1099 or
 * exposed to the browser until the token exchange step.
 */
function createAuthorizationRequest() {
  // MAIN-APP ADAPTATION: building an authorization request is part of the
  // Tax1099 integration, so it is refused while TAX1099_ENABLED is off.
  config.assertEnabled();

  if (!config.TAX1099_AUTHORIZATION_ENDPOINT) {
    const err = new Error(
      "TAX1099_AUTHORIZATION_ENDPOINT is not configured -- cannot build an authorization URL."
    );
    err.code = "TAX1099_ENDPOINT_MISSING";
    throw err;
  }

  if (!config._secrets.clientId) {
    const err = new Error("TAX1099_CLIENT_ID is not configured.");
    err.code = "TAX1099_CREDENTIAL_MISSING";
    throw err;
  }

  if (!config.TAX1099_REDIRECT_URI) {
    const err = new Error("TAX1099_REDIRECT_URI is not configured.");
    err.code = "TAX1099_REDIRECT_MISSING";
    throw err;
  }

  // MAIN-APP ADAPTATION: never send a browser to a Tax1099 production host.
  config.assertSandboxOAuthEndpoint(config.TAX1099_AUTHORIZATION_ENDPOINT);

  cleanupExpiredStates();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();

  pendingStates.set(state, { codeVerifier, createdAt: Date.now() });

  const url = new URL(config.TAX1099_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config._secrets.clientId);
  url.searchParams.set("redirect_uri", config.TAX1099_REDIRECT_URI);
  url.searchParams.set("scope", config.TAX1099_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return { state, authorizationUrl: url.toString() };
}

/**
 * Validates and consumes (one-time use) a pending state value from the
 * OAuth callback. Returns the associated PKCE code_verifier, or null if
 * the state is unknown, already used, or expired.
 */
function consumeState(state) {
  if (!state || typeof state !== "string") return null;

  cleanupExpiredStates();

  const entry = pendingStates.get(state);
  if (!entry) return null;

  pendingStates.delete(state); // one-time use, regardless of outcome
  return entry.codeVerifier;
}

function redactTokenResponse(raw = {}) {
  // Never keep or return raw token values past this module -- callers get
  // presence flags and non-sensitive metadata only.
  return {
    tokenType: raw.token_type || null,
    expiresIn: typeof raw.expires_in === "number" ? raw.expires_in : null,
    scope: raw.scope || null,
    hasAccessToken: Boolean(raw.access_token),
    hasRefreshToken: Boolean(raw.refresh_token),
    hasIdToken: Boolean(raw.id_token)
  };
}

async function postForm(endpoint, params, authHeader) {
  const body = new URLSearchParams(params);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(authHeader ? { Authorization: authHeader } : {})
    },
    body: body.toString()
  });

  let json = null;
  try {
    json = await response.json();
  } catch (parseError) {
    // fall through with json = null; handled by caller via response.ok
  }

  if (!response.ok) {
    const err = new Error(
      `Tax1099 token endpoint returned ${response.status}.`
    );
    err.code = "TAX1099_TOKEN_REQUEST_FAILED";
    err.status = response.status;
    // Intentionally do not attach the raw body -- it may contain an error
    // description that echoes back request parameters.
    throw err;
  }

  return json || {};
}

/**
 * Exchanges an authorization code for tokens. Requires network calls to be
 * explicitly enabled (config.assertNetworkAllowed()). Never logs the code,
 * the verifier, or any token value. Stores the resulting tokens in the
 * ephemeral in-memory store under `sessionKey` and returns only redacted
 * metadata to the caller.
 */
async function exchangeCodeForTokens({ code, codeVerifier, sessionKey }) {
  config.assertNetworkAllowed();

  if (!config.TAX1099_TOKEN_ENDPOINT) {
    const err = new Error("TAX1099_TOKEN_ENDPOINT is not configured.");
    err.code = "TAX1099_ENDPOINT_MISSING";
    throw err;
  }

  if (!code || !codeVerifier || !sessionKey) {
    const err = new Error(
      "exchangeCodeForTokens requires code, codeVerifier, and sessionKey."
    );
    err.code = "TAX1099_INVALID_ARGUMENTS";
    throw err;
  }

  const raw = await postForm(
    config.TAX1099_TOKEN_ENDPOINT,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.TAX1099_REDIRECT_URI,
      code_verifier: codeVerifier
    },
    buildBasicAuthHeader(config._secrets.clientId, config._secrets.clientSecret)
  );

  const now = Date.now();
  tokenStore.set(sessionKey, {
    accessToken: raw.access_token || null,
    refreshToken: raw.refresh_token || null,
    tokenType: raw.token_type || null,
    expiresAt: typeof raw.expires_in === "number" ? now + raw.expires_in * 1000 : null,
    obtainedAt: now
  });

  return redactTokenResponse(raw);
}

async function refreshAccessToken(sessionKey) {
  config.assertNetworkAllowed();

  if (!config.TAX1099_TOKEN_ENDPOINT) {
    const err = new Error("TAX1099_TOKEN_ENDPOINT is not configured.");
    err.code = "TAX1099_ENDPOINT_MISSING";
    throw err;
  }

  const existing = tokenStore.get(sessionKey);
  if (!existing || !existing.refreshToken) {
    const err = new Error("No refresh token available for this session.");
    err.code = "TAX1099_NO_REFRESH_TOKEN";
    throw err;
  }

  const raw = await postForm(
    config.TAX1099_TOKEN_ENDPOINT,
    {
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken
    },
    buildBasicAuthHeader(config._secrets.clientId, config._secrets.clientSecret)
  );

  const now = Date.now();
  tokenStore.set(sessionKey, {
    accessToken: raw.access_token || existing.accessToken,
    refreshToken: raw.refresh_token || existing.refreshToken,
    tokenType: raw.token_type || existing.tokenType,
    expiresAt: typeof raw.expires_in === "number" ? now + raw.expires_in * 1000 : existing.expiresAt,
    obtainedAt: now
  });

  return redactTokenResponse(raw);
}

/**
 * Reports whether an authenticated session exists for sessionKey, without
 * ever returning the token itself.
 */
function getSessionStatus(sessionKey) {
  const entry = tokenStore.get(sessionKey);
  if (!entry) {
    return { authenticated: false };
  }

  const expired = typeof entry.expiresAt === "number" && Date.now() >= entry.expiresAt;

  return {
    authenticated: Boolean(entry.accessToken) && !expired,
    hasRefreshToken: Boolean(entry.refreshToken),
    expired,
    obtainedAt: entry.obtainedAt,
    expiresAt: entry.expiresAt
  };
}

/**
 * Internal accessor for client.js -- returns the raw access token for
 * building an Authorization header. Not exported to routes/HTTP responses.
 */
function _getAccessTokenForRequest(sessionKey) {
  const entry = tokenStore.get(sessionKey);
  return entry ? entry.accessToken : null;
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  createAuthorizationRequest,
  consumeState,
  exchangeCodeForTokens,
  refreshAccessToken,
  getSessionStatus,
  _getAccessTokenForRequest,
  // exported for unit tests only
  _internal: { pendingStates, tokenStore, cleanupExpiredStates, base64url }
};
