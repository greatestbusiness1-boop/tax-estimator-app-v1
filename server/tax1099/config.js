"use strict";

/**
 * Tax1099 adapter configuration.
 *
 * All values come from environment variables. No credentials are hardcoded
 * anywhere in this module. Tax1099 "production" mode and outbound network
 * calls are fail-closed by default -- they must be explicitly enabled via
 * environment configuration, and production mode additionally requires this
 * deployment's own APP_ENV to be "production".
 *
 * Tax1099 support confirmed the OAuth authorization/token endpoints exist
 * and that Authorization Code + PKCE (S256) is supported, but the actual
 * endpoint URLs were communicated outside this repository and are not
 * present anywhere in it. This module never guesses or hardcodes them --
 * they must be supplied as TAX1099_AUTHORIZATION_ENDPOINT and
 * TAX1099_TOKEN_ENDPOINT. If either is missing, isFullyConfigured() reports
 * false and the OAuth routes refuse to start an authorization request.
 */

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : fallback;
}

function readBool(name, fallback = false) {
  const value = readEnv(name, "");
  if (!value) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

// APP_ENV describes THIS Tax Estimator deployment (e.g. staging vs
// production Render service) -- independent from TAX1099_ENV, which
// describes which Tax1099 account/environment (sandbox vs production) it
// talks to. Defaults to "development" so a bare local checkout never
// accidentally reports itself as staging or production.
//
// MAIN-APP ADAPTATION (Tax Estimator Revenue System, Phase 1): the main app
// does not set APP_ENV; it identifies its production host by RENDER or
// NODE_ENV=production (see CLIENT_PORTAL_PRODUCTION_HOST in server.js). An
// explicit APP_ENV still wins; otherwise a Render/production host reports
// "production" so every sandbox-only guard below blocks it.
const APP_ENV = (
  readEnv("APP_ENV", "") ||
  (readEnv("RENDER", "") || readEnv("NODE_ENV", "").toLowerCase() === "production"
    ? "production"
    : "development")
).toLowerCase();

// MAIN-APP ADAPTATION: master switch. The whole Tax1099 integration is OFF
// unless TAX1099_ENABLED is explicitly true in server configuration.
const TAX1099_ENABLED = readBool("TAX1099_ENABLED", false);

const TAX1099_ENV = (readEnv("TAX1099_ENV", "sandbox") || "sandbox").toLowerCase();
const IS_SANDBOX = TAX1099_ENV !== "production";

// MAIN-APP ADAPTATION: Phase 1 is sandbox-only. Tax1099 production mode
// (real filings, real IRS submission) is never permitted in this phase,
// regardless of TAX1099_ENV or APP_ENV. Re-enabling it is a Phase 2+
// decision that requires a separate, reviewed change.
const TAX1099_PRODUCTION_ALLOWED = false;

// Known Tax1099 PRODUCTION hosts. Server-configured OAuth endpoints may never
// point at them in this phase (data API hosts are already restricted to the
// sandbox registry in serviceUrls.js).
const PRODUCTION_TAX1099_HOST_PATTERN = /(^|\.)tax1099\.com$/i;

// Outbound Tax1099 API calls (including the OAuth token exchange) are
// disabled unless explicitly turned on. This lets the adapter, routes, and
// PKCE/state logic be exercised and unit-tested with zero real network
// activity.
const TAX1099_NETWORK_ENABLED = readBool("TAX1099_NETWORK_ENABLED", false);

const TAX1099_CLIENT_ID = readEnv("TAX1099_CLIENT_ID"); // Tax1099 "AppKey"
const TAX1099_CLIENT_SECRET = readEnv("TAX1099_CLIENT_SECRET"); // Tax1099 "Secret Key"
const TAX1099_REDIRECT_URI = readEnv("TAX1099_REDIRECT_URI");
const TAX1099_SCOPES = readEnv("TAX1099_SCOPES", "openid offline_access");
const TAX1099_AUTHORIZATION_ENDPOINT = readEnv("TAX1099_AUTHORIZATION_ENDPOINT");
const TAX1099_TOKEN_ENDPOINT = readEnv("TAX1099_TOKEN_ENDPOINT");

function credentialPresence() {
  return {
    clientId: Boolean(TAX1099_CLIENT_ID),
    clientSecret: Boolean(TAX1099_CLIENT_SECRET),
    redirectUri: Boolean(TAX1099_REDIRECT_URI),
    authorizationEndpoint: Boolean(TAX1099_AUTHORIZATION_ENDPOINT),
    tokenEndpoint: Boolean(TAX1099_TOKEN_ENDPOINT)
  };
}

function isFullyConfigured() {
  return Object.values(credentialPresence()).every(Boolean);
}

/**
 * Throws unless outbound Tax1099 network calls are explicitly allowed in
 * this deployment. Every function in auth.js/client.js that would make a
 * real HTTP request to Tax1099 must call this first.
 */
function assertEnabled() {
  if (!TAX1099_ENABLED) {
    const err = new Error(
      "The Tax1099 integration is disabled (TAX1099_ENABLED is not true)."
    );
    err.code = "TAX1099_DISABLED";
    throw err;
  }
}

/**
 * Throws unless a server-configured OAuth endpoint is an HTTPS URL that is
 * not a known Tax1099 production host. Never echoes the URL in the error.
 */
function assertSandboxOAuthEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    const err = new Error("Tax1099 OAuth endpoint is not a valid URL.");
    err.code = "TAX1099_ENDPOINT_INVALID";
    throw err;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    PRODUCTION_TAX1099_HOST_PATTERN.test(url.hostname)
  ) {
    const err = new Error("Tax1099 OAuth endpoint is not a permitted sandbox destination.");
    err.code = "TAX1099_ENDPOINT_NOT_PERMITTED";
    throw err;
  }
}

function assertNetworkAllowed() {
  assertEnabled();

  if (!TAX1099_NETWORK_ENABLED) {
    const err = new Error(
      "Tax1099 network calls are disabled (set TAX1099_NETWORK_ENABLED=true to enable)."
    );
    err.code = "TAX1099_NETWORK_DISABLED";
    throw err;
  }

  if (TAX1099_ENV === "production" && !TAX1099_PRODUCTION_ALLOWED) {
    const err = new Error(
      "Tax1099 production mode is blocked (Phase 1 is sandbox-only)."
    );
    err.code = "TAX1099_PRODUCTION_BLOCKED";
    throw err;
  }

  if (TAX1099_TOKEN_ENDPOINT) assertSandboxOAuthEndpoint(TAX1099_TOKEN_ENDPOINT);
  if (TAX1099_AUTHORIZATION_ENDPOINT) assertSandboxOAuthEndpoint(TAX1099_AUTHORIZATION_ENDPOINT);
}

module.exports = {
  APP_ENV,
  TAX1099_ENABLED,
  TAX1099_ENV,
  IS_SANDBOX,
  TAX1099_PRODUCTION_ALLOWED,
  TAX1099_NETWORK_ENABLED,
  TAX1099_SCOPES,
  TAX1099_REDIRECT_URI,
  TAX1099_AUTHORIZATION_ENDPOINT,
  TAX1099_TOKEN_ENDPOINT,
  // Only for auth.js's internal use. Never log, never return from a route,
  // never include in an error message or health-check response.
  _secrets: {
    clientId: TAX1099_CLIENT_ID,
    clientSecret: TAX1099_CLIENT_SECRET
  },
  credentialPresence,
  isFullyConfigured,
  assertEnabled,
  assertSandboxOAuthEndpoint,
  assertNetworkAllowed
};
