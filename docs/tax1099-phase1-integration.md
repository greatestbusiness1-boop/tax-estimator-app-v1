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
