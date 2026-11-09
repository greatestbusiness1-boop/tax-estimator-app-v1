# Tax1099 Integration — Phase 1 Handoff

> **Status: NOT operational for customers.** The Tax1099 module is present in
> the codebase but disabled by default, sandbox-only, not imported by
> `server.js`, and reachable through no HTTP route. No customer workflow,
> payment, or filing uses it.

## Source and destination

| | Repository | Branch | Commit |
|---|---|---|---|
| Source | `greatestbusiness1-boop/tax-estimator-tax1099-sandbox` | `tax1099-multiservice-api` | `ca29ff7` |
| Destination | `greatestbusiness1-boop/tax-estimator-app-v1` | `tax-services-revenue-system` | parent `127217d` (this commit follows it) |

The five sandbox modules were copied byte-for-byte and verified identical to
`ca29ff7` before adaptation. Not copied: `.env`, credentials, tokens,
`node_modules`, runtime data, Git metadata, and the sandbox HTTP route module
(`server/tax1099Routes.js`).

## Files

Added:

- `server/tax1099/config.js` — configuration and guards (adapted, see below)
- `server/tax1099/auth.js` — OAuth Authorization Code + PKCE (S256) helper (one guard added)
- `server/tax1099/client.js` — sandbox-only authenticated GET (unchanged)
- `server/tax1099/serviceUrls.js` — sandbox host registry and path allowlist (unchanged)
- `server/tax1099/pricingVerification.js` — internal pricing check (documentation note only)
- `test/tax1099-tax1099.test.js`, `test/tax1099-client.test.js`,
  `test/tax1099-serviceUrls.test.js`, `test/tax1099-pricingVerification.test.js`
  — sandbox tests, `require` paths adjusted; adaptations marked `MAIN-APP ADAPTATION`
- `test/tax1099-main-integration.test.js` — main-app guard tests
- `docs/tax1099-phase1-integration.md` — this document

Changed: none. `server.js`, the 1099 intake page, Stripe billing, Pinnacle,
the Client Portal, and authentication are untouched.

## Main-app adaptations (all marked `MAIN-APP ADAPTATION` in code)

1. **Master switch.** `TAX1099_ENABLED` (default `false`). While off,
   `assertNetworkAllowed()`, token exchange/refresh, authenticated GETs, and
   building an authorization URL all throw `TAX1099_DISABLED`.
2. **Production-host detection.** The main app does not set `APP_ENV`. If
   `APP_ENV` is unset, `RENDER` or `NODE_ENV=production` now makes
   `APP_ENV=production`, so the sandbox client and pricing verification are
   blocked on the live Render host. An explicit `APP_ENV` (e.g. `staging`)
   still takes precedence.
3. **Sandbox-only.** `TAX1099_PRODUCTION_ALLOWED` is always `false` in Phase 1;
   `TAX1099_ENV=production` is always blocked (`TAX1099_PRODUCTION_BLOCKED`).
4. **OAuth endpoint guard.** Server-configured `TAX1099_AUTHORIZATION_ENDPOINT`
   and `TAX1099_TOKEN_ENDPOINT` must be HTTPS, without embedded credentials,
   and not a known Tax1099 production host (`*.tax1099.com`). Errors never
   echo the URL. The real sandbox OAuth host is not recorded in either
   repository, so a positive sandbox-host allowlist is a Phase 2 item.

## Feature flags and environment

| Variable | Default | Effect |
|---|---|---|
| `TAX1099_ENABLED` | `false` | Master switch for every Tax1099 operation |
| `TAX1099_NETWORK_ENABLED` | `false` | Second, independent switch for outbound calls |
| `TAX1099_ENV` | `sandbox` | `production` is always blocked in Phase 1 |
| `APP_ENV` | derived | Explicit value wins; otherwise `production` on Render / `NODE_ENV=production` |
| `TAX1099_CLIENT_ID`, `TAX1099_CLIENT_SECRET`, `TAX1099_REDIRECT_URI`, `TAX1099_AUTHORIZATION_ENDPOINT`, `TAX1099_TOKEN_ENDPOINT` | unset | Read only by the module; never logged or returned |

No production or Render environment variable was added or changed.

## Security boundaries

- No public HTTP surface: `server.js` does not import `server/tax1099`, no
  route path contains `tax1099`, and no page calls `/api/tax1099` (enforced by
  `test/tax1099-main-integration.test.js`).
- Data API destinations are limited to the sandbox registry
  (`*.1099cloud.com`) and, for the General API, only
  `/api/v1/Common/GetFlatPricing`. Redirects are refused (`redirect: "error"`)
  so a bearer token is never forwarded.
- OAuth tokens live only in process memory, are never logged, and are
  returned to callers only as presence/metadata flags.
- `verifySandboxPricing()` compares a caller-supplied value with
  `expectedAuthorization`. **Any future invocation must obtain
  `expectedAuthorization` from trusted server-side configuration, never from
  client input, and must sit behind office authentication.** It is not exposed
  through any route.
- No payer/recipient creation, TIN collection, form creation, filing, or
  customer-data transmission exists in this module.

## Tests

- Sandbox suite in the main repo: 42/42 passing (unchanged behavior plus the
  marked adaptations).
- Main-app guards (`test/tax1099-main-integration.test.js`): 15/15 passing —
  disabled by default, production-host blocking, sandbox-only, production
  OAuth endpoint blocking, allowlist enforcement, unauthorized pricing
  invocation, no public surface, secret handling. `global.fetch` is replaced
  by a spy that fails on any network attempt.
- Full main suite (`npm test`, run once, local only): 329/329 passing
  (about 75 minutes, dominated by existing tests' Supabase retry delays).

## Known limitations

- OAuth session and tokens are in-memory only (lost on restart; single
  instance). Not suitable for production use.
- The sandbox OAuth host is not pinned (only production hosts are blocked).
- No actual Tax1099 pricing response has been verified.
- No HTTP route, office UI, or audit log exists for any Tax1099 operation.

## Phase 2 prerequisites

1. Confirm and pin the Tax1099 sandbox OAuth hosts (positive allowlist).
2. Durable, encrypted-at-rest token storage scoped to the office account.
3. Office-authenticated, server-side-authorized internal route for the
   pricing check (authorization value from server configuration only).
4. A verified sandbox pricing response.
5. Data model and encrypted storage decisions for payer/recipient TINs, and
   a recorded payer e-file authorization.
6. Billing reconciliation between Tax1099 per-form costs and Stripe quotes.
7. Resolve the authorization gaps found in the Phase 1 review of
   `/api/contractor-1099-completion-email` and
   `/api/create-contractor-1099-checkout` (see final report).

---

# Phase 2A — Internal Sandbox Pricing Pathway

> **Status: implemented and tested with mocks only. No real Tax1099 request
> has been made. Not operational on any deployment** (see prerequisites).

## What was added

- `server/tax1099/officeRoutes.js`, registered from `server.js` with the
  existing `requireOfficeDocumentReviewApi` middleware.
- Routes exist **only** when `TAX1099_ENABLED=true`, `TAX1099_ENV` is sandbox,
  and the host is not production (`APP_ENV`/`RENDER`/`NODE_ENV`). Otherwise
  every path below returns 404. The live Render production service therefore
  never exposes them.

| Route | Method | Protection | Purpose |
|---|---|---|---|
| `/api/office/tax1099/sandbox/status` | POST | office session + verification key | flags, credential presence, session presence (no values) |
| `/api/office/tax1099/sandbox/oauth/start` | POST | office session + verification key + network flag | returns the PKCE (S256) authorization URL |
| `/api/office/tax1099/sandbox/oauth/callback` | GET | one-time, 10-minute PKCE/CSRF `state` | exchanges the code; shows a plain confirmation page |
| `/api/office/tax1099/sandbox/pricing-verification` | POST | office session + verification key + network flag + connected session | read-only `GET /api/v1/Common/GetFlatPricing` |

## Server-side authorization

- New optional server setting `TAX1099_OFFICE_VERIFICATION_KEY` (>= 32 chars).
  The office user must send it in the `X-Tax1099-Verification-Key` header.
  The expected value is read only from server configuration; values in the
  request body or query string are ignored. Unset => every action returns 403.
- CSRF: actions are POST-only; the office cookie is `SameSite=Strict`; the
  custom header forces a CORS preflight. The callback is a cross-site redirect
  (office cookie intentionally absent) and is protected by the one-time state.
- Responses and logs never include tokens, the authorization code, the PKCE
  verifier, the client secret, or the verification key. Failures log only an
  error code and vendor HTTP status. Vendor error bodies are never echoed.

## OAuth / session limitations (unchanged by design in Phase 2A)

- Tokens are held in server memory only, under one shared office sandbox
  session. A restart or redeploy disconnects it; with more than one
  instance, the callback and the pricing request may hit different
  processes and fail. No persistent token storage was added.
- Real use requires a single, non-production instance.

## Endpoint verification

| Endpoint | Evidence in repositories | Status |
|---|---|---|
| `https://apipayer.1099cloud.com`, `https://apirecipient.1099cloud.com` | code comment: "confirmed by Zenwork support" | recorded as vendor-confirmed (unused in 2A) |
| `https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing` | added in sandbox commit `1030d0e`; no vendor confirmation recorded | **unverified** |
| OAuth authorization / token endpoints | "confirmed by Tax1099 support outside of this codebase"; values not recorded | **unverified here**; must be supplied as server config |
| OAuth callback whitelist | only `https://tax-estimator-tax1099-sandbox.onrender.com/api/tax1099/oauth/callback` was submitted; sandbox README (2026-09-17) lists confirmation as **Pending** | **no callback for this app is whitelisted** |

## Prerequisites before the first live sandbox pricing request

1. Written vendor confirmation that `tax1099api.1099cloud.com` +
   `/api/v1/Common/GetFlatPricing` is the sandbox General API pricing
   endpoint, and of the sandbox OAuth authorization/token URLs and scopes.
2. A non-production, single-instance deployment of this app (the production
   service blocks the routes by design), or a decision to perform the check
   from the separate sandbox service instead.
3. Tax1099 whitelisting of that deployment's callback:
   `<base-url>/api/office/tax1099/sandbox/oauth/callback`.
4. Server configuration on that deployment only: `TAX1099_ENABLED=true`,
   `TAX1099_NETWORK_ENABLED=true`, `TAX1099_ENV=sandbox`, sandbox
   `TAX1099_CLIENT_ID` / `TAX1099_CLIENT_SECRET`, `TAX1099_REDIRECT_URI`,
   both OAuth endpoints, and a fresh `TAX1099_OFFICE_VERIFICATION_KEY`.
5. Explicit owner authorization for the single read-only request below.

Proposed first live request (after all prerequisites): office user signs in,
calls `POST .../oauth/start`, completes Tax1099 sandbox sign-in in the
browser, then calls `POST .../pricing-verification`, which issues exactly one
`GET https://tax1099api.1099cloud.com/api/v1/Common/GetFlatPricing` with the
sandbox bearer token and `redirect: "error"`. No object is created.

## Phase 2A tests

`test/tax1099-office-routes.test.js` (12, mocked Tax1099/Stripe/email via
`test/helpers/mock-tax1099-fetch.js` and `test/helpers/mock-stripe-and-email.js`);
full Tax1099 set plus affected regression tests: 106/106 passing.
