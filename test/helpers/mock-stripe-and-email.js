"use strict";

// TEST-ONLY preload (node -r test/helpers/mock-stripe-and-email.js server.js).
//
// Replaces the two outbound integrations a spawned test server could reach:
//   - stripe:      checkout.sessions.create is replaced by a recorder; the
//                  real library is otherwise kept (e.g. webhook signature
//                  verification still works). No Stripe network call is made.
//   - nodemailer:  createTransport returns a recorder; nothing is sent.
//
// Every call is appended as one JSON line to MOCK_OUTBOUND_LOG so tests can
// assert exactly which sessions/emails were (or were not) created.
// Lives under test/helpers/, so `node --test test/*.test.js` never runs it.

const Module = require("node:module");
const fs = require("node:fs");

const LOG = process.env.MOCK_OUTBOUND_LOG;
if (!LOG) {
  throw new Error("MOCK_OUTBOUND_LOG must be set when using the outbound mock preload.");
}

let sessionCounter = 0;

function record(entry) {
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

const realLoad = Module._load;

Module._load = function mockedLoad(request, parent, isMain) {
  const real = realLoad.apply(this, arguments);

  if (request === "stripe") {
    return function mockedStripeFactory(...args) {
      const client = real(...args);
      client.checkout = {
        sessions: {
          create: async (params) => {
            sessionCounter += 1;
            const session = {
              id: `cs_test_mock_${process.pid}_${sessionCounter}`,
              url: `https://checkout.stripe.test/mock/${sessionCounter}`,
              amount_total: params?.line_items?.[0]?.price_data?.unit_amount ?? null
            };
            record({ type: "stripe.checkout.sessions.create", params, session });
            return session;
          }
        }
      };
      return client;
    };
  }

  if (request === "nodemailer") {
    return {
      ...real,
      createTransport: () => ({
        sendMail: async (mail) => {
          record({
            type: "email",
            to: mail.to,
            subject: mail.subject,
            text: mail.text
          });
          return { messageId: `mock-${Date.now()}` };
        }
      })
    };
  }

  return real;
};
