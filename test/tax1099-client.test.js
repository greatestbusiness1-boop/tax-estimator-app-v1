"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const CONFIG_PATH = require.resolve("../server/tax1099/config");
const AUTH_PATH = require.resolve("../server/tax1099/auth");
const CLIENT_PATH = require.resolve("../server/tax1099/client");

function loadClient(overrides) {
  const keys = [
    "APP_ENV",
    "TAX1099_ENABLED",
    "TAX1099_ENV",
    "TAX1099_NETWORK_ENABLED"
  ];

  const saved = Object.fromEntries(
    keys.map(key => [key, process.env[key]])
  );

  // MAIN-APP ADAPTATION: master switch on unless a test overrides it.
  Object.assign(process.env, { TAX1099_ENABLED: "true" }, overrides);

  for (const path of [CLIENT_PATH, AUTH_PATH, CONFIG_PATH]) {
    delete require.cache[path];
  }

  return {
    client: require("../server/tax1099/client"),
    restore() {
      for (const key of keys) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }

      for (const path of [CLIENT_PATH, AUTH_PATH, CONFIG_PATH]) {
        delete require.cache[path];
      }
    }
  };
}

test("service requests fail when network access is disabled", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "false"
  });

  try {
    await assert.rejects(
      client.authenticatedServiceGet(
        "test-session",
        "payer",
        "/api/v1/Payer"
      ),
      /network calls are disabled/i
    );
  } finally {
    restore();
  }
});

test("service requests reject production environments", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "production",
    TAX1099_ENV: "production",
    TAX1099_NETWORK_ENABLED: "true"
  });

  try {
    await assert.rejects(
      client.authenticatedServiceGet(
        "test-session",
        "recipient",
        "/api/v1/Recipient"
      ),
      /sandbox service requests are blocked/i
    );
  } finally {
    restore();
  }
});

test("rejects unauthorized destinations before accessing OAuth tokens", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "true"
  });

  const auth = require("../server/tax1099/auth");
  const originalGetToken = auth._getAccessTokenForRequest;
  let tokenAccessAttempted = false;

  auth._getAccessTokenForRequest = () => {
    tokenAccessAttempted = true;
    throw new Error("Token access must not occur.");
  };

  try {
    await assert.rejects(
      client.authenticatedServiceGet(
        "test-session",
        "payer",
        "https://unauthorized.example.com/steal"
      ),
      /Invalid Tax1099 API path/
    );

    assert.equal(tokenAccessAttempted, false);
  } finally {
    auth._getAccessTokenForRequest = originalGetToken;
    restore();
  }
});

test("authenticated service requests disable HTTP redirects", () => {
  const fs = require("node:fs");
  const path = require("node:path");

  const source = fs.readFileSync(
    path.join(__dirname, "../server/tax1099/client.js"),
    "utf8"
  );

  const serviceFunction = source.split(
    "async function authenticatedServiceGet("
  )[1];

  assert.ok(
    serviceFunction,
    "Authenticated service function must exist."
  );

  assert.match(
    serviceFunction,
    /redirect:\s*["']error["']/,
    "Authenticated requests must reject HTTP redirects."
  );
});

test("authenticated request uses approved host and disables redirects", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "true"
  });

  const auth = require("../server/tax1099/auth");
  const originalStatus = auth.getSessionStatus;
  const originalToken = auth._getAccessTokenForRequest;
  const originalFetch = global.fetch;

  let requests = 0;

  try {
    auth.getSessionStatus = () => ({ authenticated: true });
    auth._getAccessTokenForRequest = () => "fictional-test-token";

    global.fetch = async (url, options) => {
      requests++;

      assert.equal(
        url,
        "https://apipayer.1099cloud.com/api/v1/Payer"
      );

      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.Authorization,
        "Bearer fictional-test-token"
      );

      return {
        ok: true,
        json: async () => ({ test: true })
      };
    };

    const result = await client.authenticatedServiceGet(
      "test-session",
      "payer",
      "/api/v1/Payer"
    );

    assert.deepEqual(result, { test: true });
    assert.equal(requests, 1);
  } finally {
    global.fetch = originalFetch;
    auth.getSessionStatus = originalStatus;
    auth._getAccessTokenForRequest = originalToken;
    restore();
  }
});

test("rejects unauthenticated sessions without making a request", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "true"
  });

  const originalFetch = global.fetch;
  let requests = 0;

  try {
    global.fetch = async () => {
      requests++;
      throw new Error("Network must not be called.");
    };

    await assert.rejects(
      client.authenticatedServiceGet(
        "missing-session",
        "payer",
        "/api/v1/Payer"
      ),
      error => error.code === "TAX1099_NOT_AUTHENTICATED"
    );

    assert.equal(requests, 0);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test("API errors do not expose response bodies or credentials", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "true"
  });

  const auth = require("../server/tax1099/auth");
  const originalStatus = auth.getSessionStatus;
  const originalToken = auth._getAccessTokenForRequest;
  const originalFetch = global.fetch;

  try {
    auth.getSessionStatus = () => ({ authenticated: true });
    auth._getAccessTokenForRequest = () => "fictional-secret-token";

    global.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => "sensitive-response-body"
    });

    await assert.rejects(
      client.authenticatedServiceGet(
        "test-session",
        "recipient",
        "/api/v1/Recipient"
      ),
      error => {
        assert.equal(error.code, "TAX1099_API_REQUEST_FAILED");
        assert.equal(error.status, 403);
        assert.doesNotMatch(error.message, /fictional-secret-token/);
        assert.doesNotMatch(error.message, /sensitive-response-body/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
    auth.getSessionStatus = originalStatus;
    auth._getAccessTokenForRequest = originalToken;
    restore();
  }
});

test("General API pricing request uses approved endpoint", async () => {
  const { client, restore } = loadClient({
    APP_ENV: "staging",
    TAX1099_ENV: "sandbox",
    TAX1099_NETWORK_ENABLED: "true"
  });

  const auth = require("../server/tax1099/auth");
  const originalStatus = auth.getSessionStatus;
  const originalToken = auth._getAccessTokenForRequest;
  const originalFetch = global.fetch;

  let requests = 0;

  try {
    auth.getSessionStatus = () => ({ authenticated: true });
    auth._getAccessTokenForRequest = () => "fictional-test-token";

    global.fetch = async (url, options) => {
      requests++;

      assert.equal(
        url,
        "https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing"
      );
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/json");
      assert.equal(
        options.headers.Authorization,
        "Bearer fictional-test-token"
      );

      return {
        ok: true,
        json: async () => ({ mockPricing: true })
      };
    };

    const result = await client.authenticatedServiceGet(
      "test-session",
      "general",
      "/api/v1/Common/GetFlatPricing"
    );

    assert.deepEqual(result, { mockPricing: true });
    assert.equal(requests, 1);
  } finally {
    global.fetch = originalFetch;
    auth.getSessionStatus = originalStatus;
    auth._getAccessTokenForRequest = originalToken;
    restore();
  }
});