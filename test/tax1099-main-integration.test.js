"use strict";

// Tax1099 Phase 1 -- main application integration guards.
//
// The sandbox module (server/tax1099/, from tax-estimator-tax1099-sandbox
// @ ca29ff7) is covered by test/tax1099-{tax1099,client,serviceUrls,
// pricingVerification}.test.js. This file covers the main-app adaptations:
// master switch (TAX1099_ENABLED), production-host detection (RENDER /
// NODE_ENV), sandbox-only mode, production OAuth endpoint blocking, and the
// absence of any public HTTP surface. No real network request is ever made:
// global.fetch is replaced with a spy that fails the test if called.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const MODULE_DIR = path.join(REPO_ROOT, "server", "tax1099");
const MODULE_FILES = ["config", "auth", "client", "serviceUrls", "pricingVerification"];
const MODULE_PATHS = MODULE_FILES.map((name) => require.resolve(`../server/tax1099/${name}`));

const ENV_KEYS = [
  "APP_ENV",
  "RENDER",
  "NODE_ENV",
  "TAX1099_ENABLED",
  "TAX1099_ENV",
  "TAX1099_NETWORK_ENABLED",
  "TAX1099_CLIENT_ID",
  "TAX1099_CLIENT_SECRET",
  "TAX1099_REDIRECT_URI",
  "TAX1099_AUTHORIZATION_ENDPOINT",
  "TAX1099_TOKEN_ENDPOINT"
];

const SECRET = "client-secret-value-that-must-never-leak-123456";

const SANDBOX_ENV = {
  APP_ENV: undefined,
  RENDER: undefined,
  NODE_ENV: undefined,
  TAX1099_ENABLED: "true",
  TAX1099_ENV: "sandbox",
  TAX1099_NETWORK_ENABLED: "true",
  TAX1099_CLIENT_ID: "client-id-for-tests",
  TAX1099_CLIENT_SECRET: SECRET,
  TAX1099_REDIRECT_URI: "https://staging.example.test/tax1099/callback",
  TAX1099_AUTHORIZATION_ENDPOINT: "https://auth.sandbox.example-1099.test/oauth/authorize",
  TAX1099_TOKEN_ENDPOINT: "https://auth.sandbox.example-1099.test/oauth/token"
};

function load(env) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env || {})) {
    if (value !== undefined) process.env[key] = value;
  }
  for (const p of MODULE_PATHS) delete require.cache[p];

  const modules = {
    config: require("../server/tax1099/config"),
    auth: require("../server/tax1099/auth"),
    client: require("../server/tax1099/client"),
    pricing: require("../server/tax1099/pricingVerification")
  };

  const originalFetch = global.fetch;
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    throw new Error("Network access attempted in a Tax1099 Phase 1 test.");
  };

  return {
    ...modules,
    fetchCalls,
    restore() {
      global.fetch = originalFetch;
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      for (const p of MODULE_PATHS) delete require.cache[p];
    }
  };
}

function assertNoSecret(err) {
  const text = `${err && err.message} ${err && err.stack} ${JSON.stringify(err)}`;
  assert.doesNotMatch(text, new RegExp(SECRET));
}

// -----------------------------------------------------------------------------
// 1. Disabled by default
// -----------------------------------------------------------------------------

test("disabled by default: TAX1099_ENABLED unset means every Tax1099 operation is refused", async () => {
  const m = load({ ...SANDBOX_ENV, TAX1099_ENABLED: undefined });
  try {
    assert.equal(m.config.TAX1099_ENABLED, false);

    assert.throws(() => m.config.assertNetworkAllowed(), { code: "TAX1099_DISABLED" });
    assert.throws(() => m.auth.createAuthorizationRequest(), { code: "TAX1099_DISABLED" });
    await assert.rejects(
      m.auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "s" }),
      { code: "TAX1099_DISABLED" }
    );
    await assert.rejects(
      m.client.authenticatedServiceGet("s", "general", "/api/v1/Common/GetFlatPricing"),
      { code: "TAX1099_DISABLED" }
    );
    assert.equal(m.fetchCalls.length, 0);
  } finally {
    m.restore();
  }
});

test("disabled by default: an explicit TAX1099_ENABLED=false also refuses", () => {
  const m = load({ ...SANDBOX_ENV, TAX1099_ENABLED: "false" });
  try {
    assert.equal(m.config.TAX1099_ENABLED, false);
    assert.throws(() => m.config.assertNetworkAllowed(), { code: "TAX1099_DISABLED" });
  } finally {
    m.restore();
  }
});

test("enabled but network flag off: still no outbound request", async () => {
  const m = load({ ...SANDBOX_ENV, TAX1099_NETWORK_ENABLED: undefined });
  try {
    assert.throws(() => m.config.assertNetworkAllowed(), { code: "TAX1099_NETWORK_DISABLED" });
    await assert.rejects(
      m.auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "s" }),
      { code: "TAX1099_NETWORK_DISABLED" }
    );
    assert.equal(m.fetchCalls.length, 0);
  } finally {
    m.restore();
  }
});

// -----------------------------------------------------------------------------
// 2. Sandbox-only / production host protection
// -----------------------------------------------------------------------------

for (const [label, env] of [
  ["RENDER is set", { RENDER: "true" }],
  ["NODE_ENV=production", { NODE_ENV: "production" }]
]) {
  test(`production host (${label}, APP_ENV unset) blocks sandbox service requests before any network call`, async () => {
    const m = load({ ...SANDBOX_ENV, ...env });
    try {
      assert.equal(m.config.APP_ENV, "production");
      await assert.rejects(
        m.client.authenticatedServiceGet("s", "general", "/api/v1/Common/GetFlatPricing"),
        /blocked in this environment/
      );
      await assert.rejects(
        m.pricing.verifySandboxPricing({
          sessionKey: "s",
          authorization: "a".repeat(40),
          expectedAuthorization: "a".repeat(40)
        }),
        /sandbox-only/
      );
      assert.equal(m.fetchCalls.length, 0);
    } finally {
      m.restore();
    }
  });
}

test("a bare local checkout reports development, and an explicit APP_ENV still wins", () => {
  let m = load({ ...SANDBOX_ENV });
  try {
    assert.equal(m.config.APP_ENV, "development");
  } finally {
    m.restore();
  }
  m = load({ ...SANDBOX_ENV, APP_ENV: "staging", RENDER: "true" });
  try {
    assert.equal(m.config.APP_ENV, "staging");
  } finally {
    m.restore();
  }
});

test("Tax1099 production mode is blocked in Phase 1 under every combination", () => {
  for (const appEnv of ["development", "staging", "production"]) {
    const m = load({ ...SANDBOX_ENV, TAX1099_ENV: "production", APP_ENV: appEnv });
    try {
      assert.equal(m.config.IS_SANDBOX, false);
      assert.equal(m.config.TAX1099_PRODUCTION_ALLOWED, false);
      assert.throws(() => m.config.assertNetworkAllowed(), { code: "TAX1099_PRODUCTION_BLOCKED" });
    } finally {
      m.restore();
    }
  }
});

// -----------------------------------------------------------------------------
// 3. Production endpoint blocking
// -----------------------------------------------------------------------------

test("OAuth endpoints on Tax1099 production hosts, plain HTTP, or with credentials are rejected", async () => {
  for (const tokenEndpoint of [
    "https://oauth.tax1099.com/connect/token",
    "https://tax1099.com/token",
    "https://API.Tax1099.com/token",
    "http://auth.sandbox.example-1099.test/oauth/token",
    "https://user:pass@auth.sandbox.example-1099.test/oauth/token",
    "not a url"
  ]) {
    const m = load({ ...SANDBOX_ENV, TAX1099_TOKEN_ENDPOINT: tokenEndpoint });
    try {
      assert.throws(() => m.config.assertNetworkAllowed(), (err) => {
        assert.match(err.code, /^TAX1099_ENDPOINT_(NOT_PERMITTED|INVALID)$/);
        assert.doesNotMatch(err.message, /tax1099\.com|user:pass/i, "error never echoes the URL");
        return true;
      });
      await assert.rejects(
        m.auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "s" }),
        /^Error: Tax1099 OAuth endpoint/
      );
      assert.equal(m.fetchCalls.length, 0, tokenEndpoint);
    } finally {
      m.restore();
    }
  }
});

test("the authorization URL is never built for a Tax1099 production host", () => {
  const m = load({ ...SANDBOX_ENV, TAX1099_AUTHORIZATION_ENDPOINT: "https://login.tax1099.com/authorize" });
  try {
    assert.throws(() => m.auth.createAuthorizationRequest(), { code: "TAX1099_ENDPOINT_NOT_PERMITTED" });
    assert.equal(m.auth._internal.pendingStates.size, 0, "no PKCE state registered");
  } finally {
    m.restore();
  }
});

test("data API destinations stay limited to the sandbox registry and the single pricing endpoint", async () => {
  const m = load({ ...SANDBOX_ENV });
  try {
    for (const [service, apiPath] of [
      ["general", "/api/v1/Form/Submit"],
      ["general", "/api/v1/Common/GetFlatPricing/../Submit"],
      ["payer", "https://tax1099.com/api"],
      ["production", "/api/v1/anything"]
    ]) {
      await assert.rejects(m.client.authenticatedServiceGet("s", service, apiPath));
    }
    assert.equal(m.fetchCalls.length, 0);
  } finally {
    m.restore();
  }
});

// -----------------------------------------------------------------------------
// 4. No public / unauthorized invocation surface
// -----------------------------------------------------------------------------

test("no public HTTP route, page, or broad server import exposes the Tax1099 module", () => {
  const serverSource = fs.readFileSync(path.join(REPO_ROOT, "server.js"), "utf8");

  // Phase 2A: server.js may import ONLY the fail-closed office route module.
  const tax1099Imports = serverSource.match(/require\(\s*["'`]\.\/server\/tax1099\/[^"'`]+["'`]\s*\)/g) || [];
  assert.deepEqual(tax1099Imports, ['require("./server/tax1099/officeRoutes")']);
  assert.doesNotMatch(serverSource, /app\.(get|post|put|patch|delete|all|use)\(\s*["'`][^"'`]*tax1099/i);

  for (const dir of ["ui", "private-ui"]) {
    const full = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (!/\.(html|js)$/.test(file)) continue;
      const text = fs.readFileSync(path.join(full, file), "utf8");
      assert.doesNotMatch(text, /\/api\/(office\/)?tax1099/i, `${dir}/${file} must not call a Tax1099 API`);
    }
  }

  // Only the reviewed modules exist; the sandbox repo's public route module
  // was not copied. officeRoutes.js is the Phase 2A office-only module.
  const files = fs.readdirSync(MODULE_DIR).filter((name) => name.endsWith(".js")).sort();
  assert.deepEqual(files, [...MODULE_FILES, "officeRoutes"].map((name) => `${name}.js`).sort());
});

test("pricing verification rejects callers without the trusted server-side authorization value", async () => {
  const m = load({ ...SANDBOX_ENV, APP_ENV: "staging" });
  try {
    for (const authorization of [undefined, "", "short", "b".repeat(40)]) {
      await assert.rejects(
        m.pricing.verifySandboxPricing({
          sessionKey: "s",
          authorization,
          expectedAuthorization: "a".repeat(40)
        }),
        /not authorized/
      );
    }
    assert.equal(m.fetchCalls.length, 0);
  } finally {
    m.restore();
  }
});

// -----------------------------------------------------------------------------
// 5. Secret and token handling
// -----------------------------------------------------------------------------

test("configuration exposes presence flags only; secrets appear nowhere but the internal _secrets slot", () => {
  const m = load({ ...SANDBOX_ENV });
  try {
    const presence = m.config.credentialPresence();
    assert.equal(presence.clientSecret, true);
    assert.doesNotMatch(JSON.stringify(presence), new RegExp(SECRET));

    const { _secrets, ...publicConfig } = m.config;
    assert.ok(_secrets);
    assert.doesNotMatch(JSON.stringify(publicConfig), new RegExp(SECRET));
  } finally {
    m.restore();
  }
});

test("guard failures never include the client secret", async () => {
  const m = load({ ...SANDBOX_ENV, TAX1099_TOKEN_ENDPOINT: "https://oauth.tax1099.com/token" });
  try {
    try {
      m.config.assertNetworkAllowed();
      assert.fail("expected rejection");
    } catch (err) {
      assertNoSecret(err);
    }
    await m.auth
      .exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "s" })
      .catch(assertNoSecret);
  } finally {
    m.restore();
  }
});

test("the Tax1099 module contains no hardcoded credentials or logging of secrets", () => {
  for (const name of MODULE_FILES) {
    const text = fs.readFileSync(path.join(MODULE_DIR, `${name}.js`), "utf8");
    assert.doesNotMatch(text, /console\.(log|info|warn|error|debug)\([^)]*(secret|token|authorization|_secrets)/i, name);
    assert.doesNotMatch(text, /(sk_live_|sk_test_|eyJ[A-Za-z0-9_-]{20,})/, name);
  }
});
