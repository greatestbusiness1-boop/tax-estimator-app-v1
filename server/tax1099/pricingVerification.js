"use strict";

/**
 * Internal-only Tax1099 sandbox pricing verification.
 *
 * Not registered as an HTTP endpoint.
 * No credentials, tokens, or pricing response bodies are logged.
 *
 * MAIN-APP NOTE (Phase 1): `expectedAuthorization` is compared against the
 * caller-supplied `authorization`. Any future invocation MUST obtain
 * `expectedAuthorization` from trusted server-side configuration (for
 * example a server environment variable), NEVER from request input, and the
 * call site itself must sit behind office authentication. This function
 * must not be exposed through an HTTP route without a separate review.
 */

const crypto = require("node:crypto");
const config = require("./config");
const client = require("./client");

const PRICING_PATH = "/api/v1/Common/GetFlatPricing";

async function verifySandboxPricing({
  sessionKey,
  authorization,
  expectedAuthorization
}) {
  if (!config.IS_SANDBOX || config.APP_ENV === "production") {
    throw new Error("Pricing verification is sandbox-only.");
  }

  if (
    typeof authorization !== "string" ||
    typeof expectedAuthorization !== "string" ||
    authorization.length < 32 ||
    expectedAuthorization.length < 32
  ) {
    throw new Error("Pricing verification is not authorized.");
  }

  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(expectedAuthorization);

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Pricing verification is not authorized.");
  }

  if (typeof sessionKey !== "string" || !sessionKey) {
    throw new Error("An authenticated session key is required.");
  }

  return client.authenticatedServiceGet(
    sessionKey,
    "general",
    PRICING_PATH
  );
}

module.exports = {
  verifySandboxPricing
};
