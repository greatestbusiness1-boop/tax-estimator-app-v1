"use strict";

/**
 * Tax1099 sandbox service URL registry.
 * Payer and Recipient hosts confirmed by Zenwork support.
 *
 * No network requests or credentials are handled here.
 */

const SANDBOX_SERVICES = Object.freeze({
  payer: "https://apipayer.1099cloud.com",
  recipient: "https://apirecipient.1099cloud.com",
  general: "https://tax1099api.1099cloud.com"
});

function getSandboxServiceUrl(service, path) {
  if (!Object.prototype.hasOwnProperty.call(SANDBOX_SERVICES, service)) {
    throw new Error("Unknown Tax1099 sandbox service.");
  }

  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(path) ||
    /%/i.test(path) ||
    /%(?![0-9a-f]{2})/i.test(path) ||
    path.split(/[?#]/, 1)[0].split("/").some(
      segment => segment === "." || segment === ".."
    )
  ) {
    throw new Error("Invalid Tax1099 API path.");
  }

  if (service === "general" && path !== "/api/v1/Common/GetFlatPricing") {
    throw new Error("Tax1099 General API endpoint is not permitted.");
  }
  const base = SANDBOX_SERVICES[service];
  const url = new URL(path, base);

  if (
    url.origin !== base ||
    url.username ||
    url.password ||
    url.protocol !== "https:"
  ) {
    throw new Error("Tax1099 API destination is not permitted.");
  }

  return url.toString();
}

module.exports = {
  getSandboxServiceUrl
};
