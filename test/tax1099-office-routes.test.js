"use strict";

// Tax1099 Phase 2A -- internal, office-only sandbox verification routes
// (server/tax1099/officeRoutes.js), exercised through the real server.
//
// Every spawned server preloads:
//   - test/helpers/mock-tax1099-fetch.js   (Tax1099 hosts answered locally)
//   - test/helpers/mock-stripe-and-email.js (Stripe + email recorded, not sent)
// Supabase points at a local stub returning HTTP 500. No real network
// request to Tax1099, Stripe, or email is possible.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const REPO_ROOT = path.join(__dirname, "..");
const LEADS_FILE = path.join(REPO_ROOT, "leads.json");
const TAX1099_PRELOAD = path.join(__dirname, "helpers", "mock-tax1099-fetch.js");
const OUTBOUND_PRELOAD = path.join(__dirname, "helpers", "mock-stripe-and-email.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tax1099-office-routes-"));

const OFFICE_KEY = "test-only-office-access-key-for-automated-tests-xyz";
const OFFICE_SESSION_SECRET = "test-only-office-session-secret-automated-tests-32chars-min";
const VERIFICATION_KEY = "test-only-tax1099-verification-key-0123456789abcdef";
const CLIENT_SECRET = "test-only-tax1099-client-secret-value-9876543210";
const MOCK_ACCESS_TOKEN = "mock-access-token-value-7f3e9a1c5b2d4e6f8a0b";
const MOCK_REFRESH_TOKEN = "mock-refresh-token-value-1a2b3c4d5e6f7a8b9c0d";
const AUTH_CODE = "test-authorization-code-abcdef0123456789";
const FORGED_OFFICE_COOKIE =
  "tsp_office_document_review=eyJwdXJwb3NlIjoib2ZmaWNlLWRvY3VtZW50LXJldmlldyIsImV4cGlyZXNBdCI6OTk5OTk5OTk5OTk5OX0.forged-signature";
const BASE = "/api/office/tax1099/sandbox";
const PRICING_URL = "https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing";

const SERVERS = {
  enabled: { port: 3971, env: {} },
  disabled: { port: 3972, env: { TAX1099_ENABLED: "" } },
  productionHost: { port: 3973, env: { RENDER: "true", NODE_ENV: "production" } },
  productionMode: { port: 3974, env: { TAX1099_ENV: "production" } },
  networkOff: { port: 3975, env: { TAX1099_NETWORK_ENABLED: "" } },
  noVerificationKey: { port: 3976, env: { TAX1099_OFFICE_VERIFICATION_KEY: "" } }
};

let supabaseStub;
let initialLeadsJson = "";

function startSupabaseStub() {
  return new Promise((resolve) => {
    const stub = http.createServer((req, res) => {
      req.resume();
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "TEST_STUB", message: "Supabase intentionally unavailable." }));
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub));
  });
}

function startServer(name) {
  const def = SERVERS[name];
  const stubUrl = `http://127.0.0.1:${supabaseStub.address().port}`;
  def.tax1099Log = path.join(TMP, `${name}-tax1099.jsonl`);
  def.modeFile = path.join(TMP, `${name}-mode.txt`);
  def.outboundLog = path.join(TMP, `${name}-outbound.jsonl`);
  def.output = "";
  fs.writeFileSync(def.modeFile, "ok");

  const env = {
    ...process.env,
    PORT: String(def.port),
    NODE_ENV: "",
    RENDER: "",
    APP_ENV: "",
    SUPABASE_URL: stubUrl,
    NEXT_PUBLIC_SUPABASE_URL: stubUrl,
    SUPABASE_PUBLISHABLE_KEY: "test-anon-key-not-real",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key-not-real",
    SUPABASE_SECRET_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    STRIPE_SECRET_KEY: "sk_test_dummy_key_constructed_only_never_used_for_a_real_api_call",
    STRIPE_WEBHOOK_SECRET: "whsec_test_only_dummy_secret_for_automated_tests",
    OFFICE_DOCUMENT_REVIEW_KEY: OFFICE_KEY,
    OFFICE_DOCUMENT_REVIEW_SESSION_SECRET: OFFICE_SESSION_SECRET,
    PUBLIC_LEAD_ACCESS_SECRET: "test-only-public-lead-access-secret-for-automated-tests-32ch",
    CLIENT_PORTAL_SESSION_SECRET: "test-only-client-portal-session-secret-automated-tests-32chr",
    EMAIL_USER: "",
    EMAIL_APP_PASSWORD: "",
    TAX_WATCH_STRIPE_CHECKOUT_ENABLED: "",
    PINNACLE_STRIPE_CHECKOUT_ENABLED: "",
    TAX1099_ENABLED: "true",
    TAX1099_NETWORK_ENABLED: "true",
    TAX1099_ENV: "sandbox",
    TAX1099_CLIENT_ID: "test-sandbox-client-id",
    TAX1099_CLIENT_SECRET: CLIENT_SECRET,
    TAX1099_REDIRECT_URI: `http://127.0.0.1:${def.port}${BASE}/oauth/callback`,
    TAX1099_AUTHORIZATION_ENDPOINT: "https://auth.sandbox.example-1099.test/oauth/authorize",
    TAX1099_TOKEN_ENDPOINT: "https://auth.sandbox.example-1099.test/oauth/token",
    TAX1099_OFFICE_VERIFICATION_KEY: VERIFICATION_KEY,
    MOCK_TAX1099_LOG: def.tax1099Log,
    MOCK_TAX1099_MODE_FILE: def.modeFile,
    MOCK_OUTBOUND_LOG: def.outboundLog,
    ...def.env
  };

  def.child = spawn(
    process.execPath,
    ["-r", TAX1099_PRELOAD, "-r", OUTBOUND_PRELOAD, "server.js"],
    { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  def.child.stdout.on("data", (chunk) => (def.output += chunk));
  def.child.stderr.on("data", (chunk) => (def.output += chunk));
}

async function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server on port ${port} did not become ready`);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function officeCookie(port) {
  const res = await fetch(`http://127.0.0.1:${port}/api/office-document-review/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessKey: OFFICE_KEY })
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie, "office sign-in must return a session cookie");
  return cookie;
}

async function call(port, method, pathname, { cookie, key, body, query = "" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  if (key !== undefined) headers["X-Tax1099-Verification-Key"] = key;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}${query}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
    redirect: "manual"
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function assertNoSecrets(text, label) {
  for (const secret of [CLIENT_SECRET, VERIFICATION_KEY, MOCK_ACCESS_TOKEN, MOCK_REFRESH_TOKEN, AUTH_CODE]) {
    assert.ok(!String(text).includes(secret), `${label} must not contain a secret value`);
  }
}

before(async () => {
  initialLeadsJson = fs.existsSync(LEADS_FILE) ? fs.readFileSync(LEADS_FILE, "utf8") : "";
  supabaseStub = await startSupabaseStub();
  for (const name of Object.keys(SERVERS)) startServer(name);
  await Promise.all(Object.values(SERVERS).map((def) => waitForServer(def.port)));
});

after(() => {
  for (const def of Object.values(SERVERS)) if (def.child) def.child.kill();
  if (supabaseStub) supabaseStub.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// =============================================================================
// Fail-closed registration
// =============================================================================

for (const name of ["disabled", "productionHost", "productionMode"]) {
  test(`routes are not registered (${name}): every Tax1099 path is 404 even for an authorized office user`, async () => {
    const { port } = SERVERS[name];
    const cookie = await officeCookie(port);

    for (const action of ["status", "oauth/start", "pricing-verification"]) {
      const res = await call(port, "POST", `${BASE}/${action}`, { cookie, key: VERIFICATION_KEY });
      assert.equal(res.status, 404, `${name} ${action}`);
    }
    const callback = await call(port, "GET", `${BASE}/oauth/callback`, { query: `?state=x&code=${AUTH_CODE}` });
    assert.equal(callback.status, 404);
    assert.equal(readJsonl(SERVERS[name].tax1099Log).length, 0, "no Tax1099 request");
  });
}

// =============================================================================
// Office authentication + server-side authorization
// =============================================================================

test("missing or forged office session is rejected (401) before the authorization gate", async () => {
  const { port } = SERVERS.enabled;
  for (const cookie of [undefined, FORGED_OFFICE_COOKIE, "tsp_office_document_review="]) {
    for (const action of ["status", "oauth/start", "pricing-verification"]) {
      const res = await call(port, "POST", `${BASE}/${action}`, { cookie, key: VERIFICATION_KEY });
      assert.equal(res.status, 401, `${action} with cookie=${cookie ? "forged/empty" : "none"}`);
      assert.doesNotMatch(res.text, /tax1099|sandbox|pricing/i, "denial reveals nothing about Tax1099");
    }
  }
  assert.equal(readJsonl(SERVERS.enabled.tax1099Log).length, 0);
});

test("office session without the server-side authorization value is rejected (403); body/query values are ignored", async () => {
  const { port } = SERVERS.enabled;
  const cookie = await officeCookie(port);

  const attempts = [
    { key: undefined },
    { key: "" },
    { key: "wrong-key" },
    { key: VERIFICATION_KEY.slice(0, -1) + "X" },
    // The expected/supplied value is never accepted from body or query.
    { key: undefined, body: { verificationKey: VERIFICATION_KEY, expectedAuthorization: "a".repeat(48), authorization: "a".repeat(48) } },
    { key: undefined, query: `?key=${encodeURIComponent(VERIFICATION_KEY)}&x-tax1099-verification-key=${encodeURIComponent(VERIFICATION_KEY)}` }
  ];

  for (const attempt of attempts) {
    for (const action of ["status", "oauth/start", "pricing-verification"]) {
      const res = await call(port, "POST", `${BASE}/${action}`, { cookie, ...attempt });
      assert.equal(res.status, 403, `${action} ${JSON.stringify(attempt).slice(0, 60)}`);
      assert.equal(res.json.error, "Tax1099 sandbox verification is not authorized.");
    }
  }
  assert.equal(readJsonl(SERVERS.enabled.tax1099Log).length, 0);
});

test("with no server verification key configured, every action is refused even for the office", async () => {
  const { port } = SERVERS.noVerificationKey;
  const cookie = await officeCookie(port);
  for (const key of ["", "anything", VERIFICATION_KEY]) {
    const res = await call(port, "POST", `${BASE}/pricing-verification`, { cookie, key });
    assert.equal(res.status, 403);
  }
  assert.equal(readJsonl(SERVERS.noVerificationKey.tax1099Log).length, 0);
});

test("actions are POST-only (GET returns 404)", async () => {
  const { port } = SERVERS.enabled;
  const cookie = await officeCookie(port);
  for (const action of ["status", "oauth/start", "pricing-verification"]) {
    const res = await call(port, "GET", `${BASE}/${action}`, { cookie, key: VERIFICATION_KEY });
    assert.equal(res.status, 404);
  }
});

test("missing network permission refuses OAuth start and pricing without any outbound request", async () => {
  const { port } = SERVERS.networkOff;
  const cookie = await officeCookie(port);

  const start = await call(port, "POST", `${BASE}/oauth/start`, { cookie, key: VERIFICATION_KEY });
  assert.equal(start.status, 503);
  assert.equal(start.json.code, "TAX1099_NETWORK_DISABLED");

  const pricing = await call(port, "POST", `${BASE}/pricing-verification`, { cookie, key: VERIFICATION_KEY });
  assert.equal(pricing.status, 503);
  assert.equal(pricing.json.code, "TAX1099_NETWORK_DISABLED");

  assert.equal(readJsonl(SERVERS.networkOff.tax1099Log).length, 0);
});

// =============================================================================
// Full mocked sandbox flow on the enabled server
// =============================================================================

test("mocked sandbox flow: connect via OAuth (PKCE, one-time state) then read pricing", async () => {
  const def = SERVERS.enabled;
  const { port } = def;
  const cookie = await officeCookie(port);
  const auth = { cookie, key: VERIFICATION_KEY };

  // Status before connecting.
  let status = await call(port, "POST", `${BASE}/status`, auth);
  assert.equal(status.status, 200);
  assert.equal(status.json.sandbox, true);
  assert.equal(status.json.session.authenticated, false);
  assert.deepEqual(Object.values(status.json.configured), [true, true, true, true, true]);
  assertNoSecrets(status.text, "status response");

  // Pricing before connecting is refused without a request.
  let pricing = await call(port, "POST", `${BASE}/pricing-verification`, auth);
  assert.equal(pricing.status, 409);
  assert.equal(pricing.json.code, "TAX1099_NOT_AUTHENTICATED");
  assert.equal(readJsonl(def.tax1099Log).length, 0);

  // Start OAuth.
  const start = await call(port, "POST", `${BASE}/oauth/start`, auth);
  assert.equal(start.status, 200);
  const authUrl = new URL(start.json.authorizationUrl);
  assert.equal(authUrl.origin, "https://auth.sandbox.example-1099.test");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authUrl.searchParams.get("response_type"), "code");
  assert.ok(authUrl.searchParams.get("code_challenge"));
  const state = authUrl.searchParams.get("state");
  assert.ok(state);
  assertNoSecrets(start.text, "oauth start response");

  // Bad state and vendor-reported errors never reach the token endpoint.
  const badState = await call(port, "GET", `${BASE}/oauth/callback`, { query: `?state=not-the-state&code=${AUTH_CODE}` });
  assert.equal(badState.status, 400);
  const missingCode = await call(port, "GET", `${BASE}/oauth/callback`, { query: `?state=${encodeURIComponent(state)}x` });
  assert.equal(missingCode.status, 400);
  assert.equal(readJsonl(def.tax1099Log).length, 0);

  // Valid callback (no office cookie: Tax1099's redirect is cross-site).
  const callback = await call(port, "GET", `${BASE}/oauth/callback`, {
    query: `?state=${encodeURIComponent(state)}&code=${AUTH_CODE}`
  });
  assert.equal(callback.status, 200);
  assert.match(callback.text, /Tax1099 sandbox connected/);
  assertNoSecrets(callback.text, "callback page");

  let calls = readJsonl(def.tax1099Log);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "token");
  assert.equal(calls[0].grantType, "authorization_code");
  assert.equal(calls[0].usesBasicAuth, true);
  assert.equal(calls[0].secretInBody, false);
  assert.equal(calls[0].hasCodeVerifier, true);

  // State is one-time: replay does not exchange again.
  const replay = await call(port, "GET", `${BASE}/oauth/callback`, {
    query: `?state=${encodeURIComponent(state)}&code=${AUTH_CODE}`
  });
  assert.equal(replay.status, 400);
  assert.equal(readJsonl(def.tax1099Log).length, 1);

  status = await call(port, "POST", `${BASE}/status`, auth);
  assert.equal(status.json.session.authenticated, true);
  assert.equal(status.json.session.hasRefreshToken, true);
  assertNoSecrets(status.text, "status response after connect");

  // Read-only pricing request.
  pricing = await call(port, "POST", `${BASE}/pricing-verification`, auth);
  assert.equal(pricing.status, 200, pricing.text);
  assert.equal(pricing.json.ok, true);
  assert.equal(pricing.json.sandbox, true);
  assert.equal(pricing.json.pricing.data[0].formType, "1099-NEC");
  assertNoSecrets(pricing.text, "pricing response");

  calls = readJsonl(def.tax1099Log);
  const api = calls.filter((entry) => entry.type === "api");
  assert.equal(api.length, 1);
  assert.equal(api[0].url, PRICING_URL);
  assert.equal(api[0].method, "GET");
  assert.equal(api[0].redirect, "error", "redirects are refused so the bearer token is never forwarded");
  assert.equal(api[0].bearerIsMockToken, true);
});

test("vendor API error and redirect are reported without leaking vendor bodies or tokens", async () => {
  const def = SERVERS.enabled;
  const cookie = await officeCookie(def.port);
  const auth = { cookie, key: VERIFICATION_KEY };

  fs.writeFileSync(def.modeFile, "error");
  const failed = await call(def.port, "POST", `${BASE}/pricing-verification`, auth);
  assert.equal(failed.status, 502);
  assert.equal(failed.json.code, "TAX1099_API_REQUEST_FAILED");
  assert.equal(failed.json.vendorStatus, 500);
  assert.doesNotMatch(failed.text, /VENDOR-INTERNAL-DETAIL/);
  assertNoSecrets(failed.text, "vendor error response");

  fs.writeFileSync(def.modeFile, "redirect");
  const redirected = await call(def.port, "POST", `${BASE}/pricing-verification`, auth);
  assert.equal(redirected.status, 502);
  assert.equal(redirected.json.ok, false);
  assertNoSecrets(redirected.text, "redirect response");
  assert.doesNotMatch(redirected.text, /evil\.example/);

  fs.writeFileSync(def.modeFile, "ok");
});

// =============================================================================
// Side effects and secret handling
// =============================================================================

test("no taxpayer, filing, Stripe, email, or lead side effects; only the token and pricing GET were called", async () => {
  for (const [name, def] of Object.entries(SERVERS)) {
    const calls = readJsonl(def.tax1099Log);
    for (const entry of calls) {
      assert.ok(entry.type === "token" || entry.type === "api", `${name}: unexpected ${entry.type} ${entry.url}`);
      if (entry.type === "api") {
        assert.equal(entry.method, "GET");
        assert.equal(entry.url, PRICING_URL);
      }
    }
    assert.equal(readJsonl(def.outboundLog).length, 0, `${name}: no Stripe session or email`);
  }

  const currentLeads = fs.existsSync(LEADS_FILE) ? fs.readFileSync(LEADS_FILE, "utf8") : "";
  assert.equal(currentLeads, initialLeadsJson, "lead records unchanged");
});

test("server logs never contain the client secret, verification key, tokens, or authorization code", async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const [name, def] of Object.entries(SERVERS)) {
    assertNoSecrets(def.output, `${name} server log`);
  }
  assert.match(SERVERS.enabled.output, /\[tax1099 sandbox\] pricing verification failed: TAX1099_API_REQUEST_FAILED status 500/);
});
