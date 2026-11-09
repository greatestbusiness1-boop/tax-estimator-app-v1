"use strict";

/**
 * Tax1099 API client -- authenticated request wrapper.
 *
 * Scope note: as of Phase 1B-3 this repo only proves OAuth authentication.
 * This module deliberately does NOT implement payer creation, recipient
 * creation, TIN matching, W-9 collection, 1099 creation/filing, Print &
 * Mail, or any IRS/state submission. Those are explicitly out of scope
 * until authentication is proven end-to-end. Adding a new capability here
 * should be a deliberate, separately-reviewed change, not an incidental
 * one.
 */

const config = require("./config");
const auth = require("./auth");
const { getSandboxServiceUrl } = require("./serviceUrls");

/**
 * Sandbox-only authenticated GET for an explicitly approved service.
 * No redirects are followed, preventing bearer-token forwarding.
 */
async function authenticatedServiceGet(sessionKey, service, path) {
  if (!config.IS_SANDBOX || config.APP_ENV === "production") {
    throw new Error("Tax1099 sandbox service requests are blocked in this environment.");
  }

  config.assertNetworkAllowed();

  // Validate the destination before retrieving the access token.
  const url = getSandboxServiceUrl(service, path);

  const status = auth.getSessionStatus(sessionKey);
  if (!status.authenticated) {
    const err = new Error("No authenticated Tax1099 session for this key.");
    err.code = "TAX1099_NOT_AUTHENTICATED";
    throw err;
  }

  const accessToken = auth._getAccessTokenForRequest(sessionKey);

  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const err = new Error(`Tax1099 API request failed with status ${response.status}.`);
    err.code = "TAX1099_API_REQUEST_FAILED";
    err.status = response.status;
    throw err;
  }

  return response.json();
}
module.exports = {
  authenticatedServiceGet
};
