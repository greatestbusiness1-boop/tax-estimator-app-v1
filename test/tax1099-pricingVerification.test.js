"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../server/tax1099/config");
const client = require("../server/tax1099/client");
const { verifySandboxPricing } = require("../server/tax1099/pricingVerification");

const secret = "fictional-test-authorization-value-123456789";

test("rejects missing authorization without network access", async () => {
  let called = false;
  const original = client.authenticatedServiceGet;

  client.authenticatedServiceGet = async () => {
    called = true;
  };

  try {
    await assert.rejects(
      verifySandboxPricing({
        sessionKey: "test-session",
        authorization: "",
        expectedAuthorization: secret
      }),
      /not authorized/
    );

    assert.equal(called, false);
  } finally {
    client.authenticatedServiceGet = original;
  }
});

test("rejects incorrect authorization without network access", async () => {
  let called = false;
  const original = client.authenticatedServiceGet;

  client.authenticatedServiceGet = async () => {
    called = true;
  };

  try {
    await assert.rejects(
      verifySandboxPricing({
        sessionKey: "test-session",
        authorization: "incorrect-authorization-value-123456789",
        expectedAuthorization: secret
      }),
      /not authorized/
    );

    assert.equal(called, false);
  } finally {
    client.authenticatedServiceGet = original;
  }
});

test("blocks production configuration", async () => {
  const originalEnv = config.APP_ENV;

  try {
    config.APP_ENV = "production";

    await assert.rejects(
      verifySandboxPricing({
        sessionKey: "test-session",
        authorization: secret,
        expectedAuthorization: secret
      }),
      /sandbox-only/
    );
  } finally {
    config.APP_ENV = originalEnv;
  }
});

test("authorized invocation uses only the allowlisted pricing GET client", async () => {
  const original = client.authenticatedServiceGet;
  const calls = [];

  client.authenticatedServiceGet = async (...args) => {
    calls.push(args);
    return { testPricing: true };
  };

  try {
    const result = await verifySandboxPricing({
      sessionKey: "test-session",
      authorization: secret,
      expectedAuthorization: secret
    });

    assert.deepEqual(result, { testPricing: true });
    assert.deepEqual(calls, [
      ["test-session", "general", "/api/v1/Common/GetFlatPricing"]
    ]);
  } finally {
    client.authenticatedServiceGet = original;
  }
});
