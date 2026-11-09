"use strict";

// TEST-ONLY preload: intercepts outbound fetch() to Tax1099-family hosts in a
// spawned test server so no real Tax1099 request can ever leave the machine.
//
//   - OAuth token endpoint (.../oauth/token on *.example-1099.test): returns
//     fixed mock tokens.
//   - https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing: behavior
//     selected per call by the contents of MOCK_TAX1099_MODE_FILE:
//       "ok" (default) -> 200 JSON pricing
//       "error"        -> 500 with a body that must never be echoed
//       "redirect"     -> emulates fetch(..., { redirect: "error" }) failing
//   - Any other Tax1099-family host -> recorded as "unexpected" and rejected.
// Every intercepted call is appended to MOCK_TAX1099_LOG as one JSON line.
// All other fetches (e.g. the local Supabase stub) pass through unchanged.

const fs = require("node:fs");

const LOG = process.env.MOCK_TAX1099_LOG;
const MODE_FILE = process.env.MOCK_TAX1099_MODE_FILE;
if (!LOG || !MODE_FILE) {
  throw new Error("MOCK_TAX1099_LOG and MOCK_TAX1099_MODE_FILE must be set for the Tax1099 fetch mock.");
}

const MOCK_ACCESS_TOKEN = "mock-access-token-value-7f3e9a1c5b2d4e6f8a0b";
const MOCK_REFRESH_TOKEN = "mock-refresh-token-value-1a2b3c4d5e6f7a8b9c0d";
const MOCK_PRICING = {
  isSuccess: true,
  data: [
    { formType: "1099-NEC", eFilePrice: 2.9 },
    { formType: "1099-MISC", eFilePrice: 2.9 }
  ]
};

const TAX1099_FAMILY = /(^|\.)(1099cloud\.com|tax1099\.com|example-1099\.test)$/i;
const realFetch = global.fetch;

function record(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

function mode() {
  try {
    return fs.readFileSync(MODE_FILE, "utf8").trim() || "ok";
  } catch {
    return "ok";
  }
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

global.fetch = async function mockedFetch(input, options = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (!TAX1099_FAMILY.test(url.hostname)) {
    return realFetch(input, options);
  }

  const method = String(options.method || "GET").toUpperCase();
  const authorization = headerValue(options.headers, "authorization");

  if (url.hostname.endsWith("example-1099.test") && url.pathname.endsWith("/oauth/token")) {
    const body = new URLSearchParams(String(options.body || ""));
    record({
      type: "token",
      url: url.origin + url.pathname,
      method,
      grantType: body.get("grant_type"),
      hasCode: Boolean(body.get("code")),
      hasCodeVerifier: Boolean(body.get("code_verifier")),
      usesBasicAuth: authorization.startsWith("Basic "),
      secretInBody: /client_secret/.test(String(options.body || ""))
    });
    return new Response(
      JSON.stringify({
        access_token: MOCK_ACCESS_TOKEN,
        refresh_token: MOCK_REFRESH_TOKEN,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid offline_access"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (url.origin === "https://tax1099api.1099cloud.com" && url.pathname === "/api/v1/Common/GetFlatPricing") {
    const current = mode();
    record({
      type: "api",
      url: url.toString(),
      method,
      redirect: options.redirect || "follow",
      bearerIsMockToken: authorization === `Bearer ${MOCK_ACCESS_TOKEN}`,
      mode: current
    });

    if (current === "error") {
      return new Response(
        JSON.stringify({ message: "VENDOR-INTERNAL-DETAIL-MUST-NOT-LEAK" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (current === "redirect") {
      if (options.redirect === "error") {
        throw new TypeError("fetch failed");
      }
      return new Response(null, { status: 302, headers: { Location: "https://evil.example/steal" } });
    }

    return new Response(JSON.stringify(MOCK_PRICING), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  record({ type: "unexpected", url: url.origin + url.pathname, method });
  throw new Error("Unexpected Tax1099 destination in test.");
};

module.exports = { MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN, MOCK_PRICING };
