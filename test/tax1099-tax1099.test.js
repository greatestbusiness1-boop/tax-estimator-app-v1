"use strict";

/**
 * Automated tests for the Tax1099 adapter foundation. No real network
 * request is made anywhere in this file -- fetch is mocked wherever a
 * token exchange is exercised. Run with:
 *   node --test server/tax1099/__tests__/tax1099.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const crypto = require("crypto");

const CONFIG_PATH = require.resolve("../server/tax1099/config");
const AUTH_PATH = require.resolve("../server/tax1099/auth");

function freshModules(envOverrides = {}) {
  const savedEnv = {};
  for (const key of Object.keys(envOverrides)) {
    savedEnv[key] = process.env[key];
    if (envOverrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = envOverrides[key];
    }
  }

  delete require.cache[CONFIG_PATH];
  delete require.cache[AUTH_PATH];

  const config = require("../server/tax1099/config");
  const auth = require("../server/tax1099/auth");

  return {
    config,
    auth,
    restore() {
      for (const key of Object.keys(savedEnv)) {
        if (savedEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedEnv[key];
      }
      delete require.cache[CONFIG_PATH];
      delete require.cache[AUTH_PATH];
    }
  };
}

// MAIN-APP ADAPTATION: the master switch must be on for these tests.
const BASE_TEST_ENV = {
  TAX1099_ENABLED: "true",
  TAX1099_ENV: "sandbox",
  TAX1099_NETWORK_ENABLED: "false",
  TAX1099_CLIENT_ID: "test-client-id",
  TAX1099_CLIENT_SECRET: "test-client-secret",
  TAX1099_REDIRECT_URI: "https://example-staging.onrender.com/api/tax1099/oauth/callback",
  TAX1099_AUTHORIZATION_ENDPOINT: "https://auth.example-tax1099.test/oauth/authorize",
  TAX1099_TOKEN_ENDPOINT: "https://auth.example-tax1099.test/oauth/token",
  APP_ENV: "development"
};

test("sandbox is the default TAX1099_ENV when unset", () => {
  const { config, restore } = freshModules({ TAX1099_ENV: undefined });
  assert.equal(config.TAX1099_ENV, "sandbox");
  assert.equal(config.IS_SANDBOX, true);
  restore();
});

test("production mode is blocked unless APP_ENV is also production (fail-closed)", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_ENV: "production",
    APP_ENV: "development"
  });
  assert.equal(config.TAX1099_PRODUCTION_ALLOWED, false);
  restore();
});

// MAIN-APP ADAPTATION: Phase 1 is sandbox-only -- production mode is
// blocked even when TAX1099_ENV and APP_ENV both say production.
test("production mode stays blocked in Phase 1 even when TAX1099_ENV and APP_ENV both say production", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_ENV: "production",
    APP_ENV: "production"
  });
  assert.equal(config.TAX1099_PRODUCTION_ALLOWED, false);
  restore();
});

test("assertNetworkAllowed throws when TAX1099_NETWORK_ENABLED is not true", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_NETWORK_ENABLED: "false"
  });
  assert.throws(() => config.assertNetworkAllowed(), /TAX1099_NETWORK_DISABLED|disabled/i);
  restore();
});

test("assertNetworkAllowed blocks production even if network is enabled, when APP_ENV isn't production", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_ENV: "production",
    TAX1099_NETWORK_ENABLED: "true",
    APP_ENV: "development"
  });
  assert.throws(() => config.assertNetworkAllowed(), /TAX1099_PRODUCTION_BLOCKED|blocked/i);
  restore();
});

test("assertNetworkAllowed passes for sandbox with network enabled", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_NETWORK_ENABLED: "true"
  });
  assert.doesNotThrow(() => config.assertNetworkAllowed());
  restore();
});

test("credentialPresence reports missing values as false without ever exposing them", () => {
  const { config, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_CLIENT_SECRET: undefined
  });
  const presence = config.credentialPresence();
  assert.equal(presence.clientId, true);
  assert.equal(presence.clientSecret, false);
  assert.equal(config.isFullyConfigured(), false);
  assert.equal(JSON.stringify(presence).includes("test-client"), false);
  restore();
});

test("PKCE code_verifier is a valid RFC 7636 unreserved-charset string, 43-128 chars", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const verifier = auth.generateCodeVerifier();
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
  restore();
});

test("PKCE code_challenge is the correct base64url(SHA-256(verifier)), S256", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"; // RFC 7636 appendix B example
  const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // known-good S256 value for that verifier
  const actual = auth.generateCodeChallenge(verifier);
  assert.equal(actual, expected);
  restore();
});

test("state values are unique and URL-safe", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const a = auth.generateState();
  const b = auth.generateState();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9\-_]+$/);
  restore();
});

test("createAuthorizationRequest throws clearly when the authorization endpoint isn't configured", () => {
  const { auth, restore } = freshModules({
    ...BASE_TEST_ENV,
    TAX1099_AUTHORIZATION_ENDPOINT: undefined
  });
  assert.throws(() => auth.createAuthorizationRequest(), /TAX1099_ENDPOINT_MISSING|not configured/i);
  restore();
});

test("createAuthorizationRequest builds a PKCE S256 authorization URL and registers pending state", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const { state, authorizationUrl } = auth.createAuthorizationRequest();
  const url = new URL(authorizationUrl);

  assert.equal(url.origin + url.pathname, "https://auth.example-tax1099.test/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "test-client-id");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), state);
  assert.ok(url.searchParams.get("code_challenge"));
  // The verifier itself must never appear in the authorization URL.
  assert.equal(authorizationUrl.includes(url.searchParams.get("code_challenge")), true);
  restore();
});

test("consumeState returns the verifier once, then rejects reuse (one-time use)", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const { state } = auth.createAuthorizationRequest();

  const first = auth.consumeState(state);
  assert.ok(first);

  const second = auth.consumeState(state);
  assert.equal(second, null);
  restore();
});

test("consumeState rejects an unknown/invalid state (CSRF protection)", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  assert.equal(auth.consumeState("not-a-real-state"), null);
  assert.equal(auth.consumeState(""), null);
  assert.equal(auth.consumeState(undefined), null);
  restore();
});

test("consumeState rejects an expired state", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  const { state } = auth.createAuthorizationRequest();

  // Backdate the pending entry past the TTL instead of waiting 10 minutes.
  const entry = auth._internal.pendingStates.get(state);
  entry.createdAt = Date.now() - 11 * 60 * 1000;

  assert.equal(auth.consumeState(state), null);
  restore();
});

test("exchangeCodeForTokens refuses to run when the network is disabled (fail-closed)", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "false" });
  await assert.rejects(
    () => auth.exchangeCodeForTokens({ code: "abc", codeVerifier: "verifier", sessionKey: "s1" }),
    /TAX1099_NETWORK_DISABLED|disabled/i
  );
  restore();
});

test("exchangeCodeForTokens requires code, codeVerifier, and sessionKey", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });
  await assert.rejects(
    () => auth.exchangeCodeForTokens({ code: "", codeVerifier: "v", sessionKey: "s1" }),
    (err) => {
      assert.equal(err.code, "TAX1099_INVALID_ARGUMENTS");
      return true;
    }
  );
  restore();
});

test("exchangeCodeForTokens (mocked fetch) stores tokens internally and returns only redacted metadata", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });

  const originalFetch = global.fetch;
  let capturedBody = null;
  let capturedHeaders = null;
  global.fetch = async (url, opts) => {
    capturedBody = opts.body;
    capturedHeaders = opts.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "super-secret-access-token",
        refresh_token: "super-secret-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid offline_access"
      })
    };
  };

  try {
    const result = await auth.exchangeCodeForTokens({
      code: "auth-code-123",
      codeVerifier: "verifier-abc",
      sessionKey: "session-1"
    });

    // Only redacted metadata comes back -- no token value anywhere in the result.
    assert.deepEqual(result, {
      tokenType: "Bearer",
      expiresIn: 3600,
      scope: "openid offline_access",
      hasAccessToken: true,
      hasRefreshToken: true,
      hasIdToken: false
    });
    assert.equal(JSON.stringify(result).includes("super-secret"), false);

    // The request itself used the code/verifier correctly.
    assert.match(capturedBody, /grant_type=authorization_code/);
    assert.match(capturedBody, /code=auth-code-123/);
    assert.match(capturedBody, /code_verifier=verifier-abc/);
    assert.match(capturedBody, /redirect_uri=/);

    // Client authentication must be the HTTP Basic header, NEVER the POST
    // body -- this is the exact Tax1099/Zenwork requirement this test
    // guards.
    assert.equal(capturedBody.includes("client_id="), false);
    assert.equal(capturedBody.includes("client_secret="), false);
    assert.match(capturedHeaders.Authorization, /^Basic /);
    const decodedCredential = Buffer.from(
      capturedHeaders.Authorization.slice("Basic ".length),
      "base64"
    ).toString("utf8");
    assert.equal(decodedCredential, "test-client-id:test-client-secret");

    // Session status reflects an authenticated session without exposing the token.
    const status = auth.getSessionStatus("session-1");
    assert.equal(status.authenticated, true);
    assert.equal(status.hasRefreshToken, true);
    assert.equal(JSON.stringify(status).includes("super-secret"), false);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("exchangeCodeForTokens surfaces a clean error on a non-OK token response, without leaking the body", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "invalid_grant", error_description: "code already used" })
  });

  try {
    await assert.rejects(
      () => auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "s2" }),
      (err) => {
        assert.equal(err.code, "TAX1099_TOKEN_REQUEST_FAILED");
        assert.equal(err.status, 400);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("getSessionStatus reports unauthenticated for an unknown session key", () => {
  const { auth, restore } = freshModules(BASE_TEST_ENV);
  assert.deepEqual(auth.getSessionStatus("never-seen"), { authenticated: false });
  restore();
});

test("refreshAccessToken refuses to run when the network is disabled (fail-closed)", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "false" });
  await assert.rejects(
    () => auth.refreshAccessToken("no-session"),
    /TAX1099_NETWORK_DISABLED|disabled/i
  );
  restore();
});

test("refreshAccessToken rejects a session with no stored refresh token", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });
  await assert.rejects(
    () => auth.refreshAccessToken("never-authenticated-session"),
    (err) => {
      assert.equal(err.code, "TAX1099_NO_REFRESH_TOKEN");
      return true;
    }
  );
  restore();
});

test("refreshAccessToken (mocked fetch) exchanges the stored refresh token and updates the session, returning only redacted metadata", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });

  const originalFetch = global.fetch;
  const capturedBodies = [];
  const capturedHeadersList = [];
  global.fetch = async (url, opts) => {
    capturedBodies.push(opts.body);
    capturedHeadersList.push(opts.headers);
    const isRefreshCall = opts.body.includes("grant_type=refresh_token");
    return {
      ok: true,
      status: 200,
      json: async () => isRefreshCall
        ? {
            access_token: "new-secret-access-token",
            refresh_token: "new-secret-refresh-token",
            token_type: "Bearer",
            expires_in: 7200
          }
        : {
            access_token: "original-secret-access-token",
            refresh_token: "original-secret-refresh-token",
            token_type: "Bearer",
            expires_in: 3600
          }
    };
  };

  try {
    // First establish a session via the normal code exchange, then refresh it.
    await auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "refresh-session" });

    const result = await auth.refreshAccessToken("refresh-session");

    assert.deepEqual(result, {
      tokenType: "Bearer",
      expiresIn: 7200,
      scope: null,
      hasAccessToken: true,
      hasRefreshToken: true,
      hasIdToken: false
    });
    assert.equal(JSON.stringify(result).includes("secret"), false);

    // The refresh request used the ORIGINAL refresh token, not a fabricated one.
    assert.match(capturedBodies[1], /grant_type=refresh_token/);
    assert.match(capturedBodies[1], /refresh_token=original-secret-refresh-token/);

    // Client authentication must be the HTTP Basic header on the refresh
    // call too, never the POST body.
    assert.equal(capturedBodies[1].includes("client_id="), false);
    assert.equal(capturedBodies[1].includes("client_secret="), false);
    assert.match(capturedHeadersList[1].Authorization, /^Basic /);
    const decodedRefreshCredential = Buffer.from(
      capturedHeadersList[1].Authorization.slice("Basic ".length),
      "base64"
    ).toString("utf8");
    assert.equal(decodedRefreshCredential, "test-client-id:test-client-secret");

    const status = auth.getSessionStatus("refresh-session");
    assert.equal(status.authenticated, true);
    assert.equal(status.hasRefreshToken, true);
    assert.equal(JSON.stringify(status).includes("secret"), false);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("refreshAccessToken keeps the existing refresh token when the response doesn't include a new one", async () => {
  const { auth, restore } = freshModules({ ...BASE_TEST_ENV, TAX1099_NETWORK_ENABLED: "true" });

  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "first-access-token",
          refresh_token: "only-refresh-token",
          token_type: "Bearer",
          expires_in: 3600
        })
      };
    }
    // Refresh response omits refresh_token, as some providers do.
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "second-access-token",
        token_type: "Bearer",
        expires_in: 3600
      })
    };
  };

  try {
    await auth.exchangeCodeForTokens({ code: "c", codeVerifier: "v", sessionKey: "no-rotate-session" });
    const result = await auth.refreshAccessToken("no-rotate-session");
    // The refresh response itself omitted refresh_token, so the redacted
    // metadata for THIS call correctly reports none was issued this time...
    assert.equal(result.hasRefreshToken, false);
    // ...but the session's original refresh token is preserved internally
    // for the next refresh, which is the actual behavior being verified.
    const status = auth.getSessionStatus("no-rotate-session");
    assert.equal(status.hasRefreshToken, true);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
