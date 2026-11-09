"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getSandboxServiceUrl } = require("../server/tax1099/serviceUrls");

test("constructs approved payer and recipient URLs", () => {
  assert.equal(
    getSandboxServiceUrl("payer", "/api/v1/Payer/Save"),
    "https://apipayer.1099cloud.com/api/v1/Payer/Save"
  );

  assert.equal(
    getSandboxServiceUrl("recipient", "/api/v1/Recipient/Save"),
    "https://apirecipient.1099cloud.com/api/v1/Recipient/Save"
  );
});

test("rejects unknown services", () => {
  assert.throws(() => getSandboxServiceUrl("filing", "/api/v1/test"));
  assert.throws(() => getSandboxServiceUrl("__proto__", "/api/v1/test"));
});

test("rejects absolute URLs and protocol-relative destinations", () => {
  assert.throws(() =>
    getSandboxServiceUrl("payer", "https://example.com/steal")
  );

  assert.throws(() =>
    getSandboxServiceUrl("payer", "//example.com/steal")
  );
});

test("rejects backslashes and control characters", () => {
  assert.throws(() =>
    getSandboxServiceUrl("payer", "/api\\evil")
  );

  assert.throws(() =>
    getSandboxServiceUrl("payer", "/api\nbad")
  );
});

test("rejects encoded separators and traversal attempts", () => {
  const invalidPaths = [
    "/api/%252fsecret",
    "/api/%252e%252e/secret",
    "/api/%2fexample",
    "/api/%2Fexample",
    "/api/%5cexample",
    "/api/%2e%2e/secret",
    "/api/../secret",
    "/api/./secret",
    "/api/%00example",
    "/api/%0aexample",
    "/api/%0dexample"
  ];

  for (const path of invalidPaths) {
    assert.throws(
      () => getSandboxServiceUrl("payer", path),
      `Expected rejection of: ${path}`
    );
  }
});



test("permits only the documented General pricing endpoint", () => {
  const allowed = getSandboxServiceUrl(
    "general",
    "/api/v1/Common/GetFlatPricing"
  );

  assert.equal(
    allowed,
    "https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing"
  );

  for (const path of [
    "/api/v1/Common/OtherEndpoint",
    "/api/v1/Payer/Save",
    "/api/v1/Common/GetFlatPricing?unexpected=true",
    "/api/v1/Common/GetFlatPricing#fragment"
  ]) {
    assert.throws(
      () => getSandboxServiceUrl("general", path),
      /not permitted/
    );
  }
});
