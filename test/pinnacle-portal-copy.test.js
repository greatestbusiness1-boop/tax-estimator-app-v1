"use strict";
// Regression test for the Pinnacle Plans & Pricing copy correction.
//
// The Client Portal's Plans & Pricing hero paragraph used to read "...Tax
// Watch Pro is available for preview now; Pinnacle remains planned and
// will open here when released..." -- stale product-development wording
// left over from before Pinnacle was implemented. It has since been
// replaced with feature-neutral copy that describes what Pinnacle is
// without claiming it is unfinished, and without claiming checkout is
// currently available (checkout availability is communicated separately,
// dynamically, by configureMembershipCheckoutButtons()).
//
// This is a pure source-content check (no server spawn needed) guarding
// against the stale wording reappearing and against the legitimate,
// flag-driven "Pinnacle Checkout Not Yet Available" button copy being
// removed by a future edit.
//
// Run with: npm test  (node --test test/)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const PORTAL_HOME_FILE = path.join(
  __dirname,
  "..",
  "private-ui",
  "client-portal-home.html"
);

function readPortalHome() {
  return fs.readFileSync(PORTAL_HOME_FILE, "utf8");
}

test("A. The stale 'Pinnacle remains planned and will open here when released' wording is gone", () => {
  const html = readPortalHome();
  assert.doesNotMatch(
    html,
    /Pinnacle remains planned/i,
    "obsolete product-development wording must not reappear"
  );
  assert.doesNotMatch(
    html,
    /will open here when released/i,
    "obsolete release-timing wording must not reappear"
  );
});

test("B. The Plans & Pricing hero paragraph describes Pinnacle without claiming checkout is currently available", () => {
  const html = readPortalHome();
  const match = /<h2>Start Free\. Add More Guidance When You Need It\.<\/h2>\s*<p>([^<]*)<\/p>/.exec(html);
  assert.ok(match, "the Plans & Pricing hero paragraph must exist");

  const paragraph = match[1];
  assert.match(paragraph, /Pinnacle builds on Tax Watch Pro/);
  assert.doesNotMatch(paragraph, /available for preview now/i);
  assert.doesNotMatch(paragraph, /planned/i);
  assert.doesNotMatch(paragraph, /coming soon/i);
  assert.doesNotMatch(paragraph, /not (yet )?released/i);
  // Must not claim checkout is open -- that is communicated only by the
  // dynamic, flag-driven button copy checked in test C.
  assert.doesNotMatch(paragraph, /\bpurchase\b/i);
  assert.doesNotMatch(paragraph, /\bcheckout is (now )?open\b/i);
});

test("C. The legitimate, flag-driven checkout-disabled button copy is untouched", () => {
  const html = readPortalHome();
  assert.match(
    html,
    /"Pinnacle Checkout Not Yet Available"/,
    "the real, availability-flag-driven disabled-button copy must still exist"
  );
});

test("D. Pinnacle pricing remains unchanged ($34.99/month, $349/year)", () => {
  const html = readPortalHome();
  assert.match(html, /\$34\.99/);
  assert.match(html, /\$349/);
});
