# GoreeCloud Finances — read-only personal financial dashboard

**Maturity:** v0.9.0-alpha.0 development preview; **not** a production service or financial advice. Source includes a new local owner account and optional authorized Plaid adapter. No real banks have been linked or verified.

## Private owner dashboard (new)

Requires **Node.js 22+**. No npm install or third-party runtime packages are needed.

```sh
npm start
# Open http://127.0.0.1:8787/ on the same computer.
```

On first launch, **create your own username and password** for the GoreeCloud Finances app. The password encrypts the local vault; it is **not** a bank login. Sign in to see all seven institution cards and any account data you've linked or imported. Every app opening initiates a refresh check of existing connected providers; the UI reports the check time and how recently the upstream source says its data was updated.

**Live banking connections are not enabled by default.** A read-only Plaid Link adapter is available only when you supply your own authorized Plaid credentials and confirm the required product access, provider coverage, terms and costs. One-time institution authorization is attempted **per provider** where supported; not all providers or account types are guaranteed compatible. No banking password is stored by the app. Connections can be revoked from the dashboard. The hosted local mode stores imported CSV and provider tokens **encrypted at rest**.

### v0.9.0 alpha — private complete stored-history browsing

- **Server-side stored-history search:** search all transactions currently preserved inside your local encrypted vault rather than only the old 200-row dashboard preview. Search accepts institution, CSV/provider source, text and inclusive start/end dates.
- **Progressive 50-row pages:** the browser displays the first 50 matching records and a Show 50 more button. An account balance or refreshed bank feed is **not** implied by the number of locally stored transactions.
- **Clear filters and accessible controls:** all filters have labels and keyboard support; results show a live status count, an empty state and a visible distinction between imported and connected-provider records. Old async search results are discarded if your filters change or you sign out.
- **Data minimization:** the dashboard overview returns only aggregate counts and account summaries; transaction descriptions are fetched from the authenticated, CSRF-protected search endpoint on demand, with no search terms placed in URLs or browser storage.
- **Bounded validation:** reject impossible dates, invalid institution/source, abusive page numbers and oversized query terms. The API returns at most 100 records per request and is covered by synthetic integration tests.

### v0.8.0 alpha — data accuracy and one-time linking maintenance

- **Occurrence-correct offline imports:** repeated equal-value transactions in overlapping statement exports now persist exactly when a later file contains more occurrences; duplicate reimports remain idempotent. The UI still cannot reconcile exports with provider transaction IDs; overlapping provider/CSV sources may duplicate real-world transactions and require review.
- **Reconnect existing provider authorization:** each connected provider link now has a Renew access / Reconnect action. It invokes Plaid Link update mode on the existing server-held encrypted Item token, not a new authorization exchange. The server re-verifies institution identity and checks the data without claiming new transactions were published.
- **Faster read-only checks:** on opening the app and manual refresh, up to three independent linked Items are checked in parallel. Failed checks retain the previous encrypted account data and display an attention state.
- The current platform remains a loopback-only, single-owner development alpha. Live institution coverage, OAuth redirect acceptance, and cost/production behavior are not established.

### New: safer recovery and synchronization (v0.7.0 alpha)

- **Change your vault password** in the signed-in dashboard. Existing encrypted state is atomically re-encrypted using a new salt, and prior sessions are revoked. There is still **no forgotten-password recovery**.
- **Local encrypted backup:** run npm run vault:backup to make a sealed copy in the private backups directory (outside the repository by default).
- **Non-overwriting restore:** stop the server, ensure the target vault does not exist, then run npm run vault:restore -- /absolute/path/to/backup.encrypted.json; sign in using the password from when the backup was created.
- **Plaid reliability:** retries transaction pagination mutations starting at the original cursor, without persisting incomplete pages. Optional paid requests have a 30-minute local cooldown per item and operation, while routine provider checks remain enabled.
- No new accounts are connected by these development improvements.

See [setup, configuration, security and refresh behavior](docs/PRIVATE_DASHBOARD.md), [Security policy](SECURITY.md), and [Upstream review](docs/UPSTREAM_REVIEW.md).

## Earlier completely offline viewer

## Features

**v0.5.0 development increment:** adds a filtered account-movement audit table with date coverage, entry counts and exact-cent net movement by institution and account label. It is not a balance reconciliation or a guarantee of complete statements.

**v0.4.0 development increment:** monthly exact-cent activity table (latest 24 months, current filters), filtered spending-by-institution chart, and a guard against clearing the session during an asynchronous file import. Earlier v0.3.0 added inclusive date filtering, composed institution/text/date filters, and bounded 100-row pagination. Invalid/reversed date ranges fail closed without altering imported data.

- Seven offline statement categories: Navy Federal, Cash App, Varo, Capital One, Marcus, Discover, PayPal.
- Strict, quoted-field-aware CSV import (`date,description,amount`, UTF-8, ISO calendar dates, USD).
- Integer-cent arithmetic (BigInt in browser, Decimal in Python); no floating-point totals.
- Multi-file import, per-label grouping, institution filters, text search, monthly activity, filtered spending breakdown, masked display, and in-memory clearing.
- Occurrence-aware exact-match deduplication: re-importing the same file won't duplicate its entries, and identical rows inside one file are not silently removed. No unique bank transaction IDs are available; overlapping exports remain ambiguous and must be reconciled with originals.
- CSP denies outbound connectivity and all account/payment integrations. No credentials, cookies, localStorage, persistent database, analytics, external assets, external scripts, or network APIs.
- Alpha styling uses selected **verified** GoreeCloud UI token values from `GoreeCloud/gc-ui` (`src/tokens.css`, reviewed November 13, 2026). GC UI itself is alpha and the subset is not a stable design-system package.

## Run the original standalone offline viewer

Open `app/index.html` in a recent browser. The application is static and works without a web server; all local resources are bundled.

## Run tests

```sh
python -m unittest discover -s tests -v
npm test
```

Browser smoke tests (optional) require Python Playwright and Chromium. Run `python -m unittest tests/browser_smoke.py -v`; it starts a temporary localhost static server but the app never contacts a bank or external endpoint. **In this execution environment, Chromium navigation is blocked by administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`), so browser QA is not yet verified.**

## CSV example (synthetic only)

```csv
date,description,amount
2026-11-01,"Example deposit",1200.00
2026-11-02,"Example shop, Inc.",-12.34
```

`amount` is signed: positive entries count as inflow; negative entries count as outflow. Amounts are **not balances**, and net movement is not net worth. No actual bank or provider statement format is assumed. If a bank export differs, normalize it offline before use; do not upload real statements to untrusted converters.

## Open-source licensing and attribution

GoreeCloud Finances source is licensed under **MIT**. See [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the project-specific license selection and GoreeCloud UI alpha-token provenance. Financial-provider names identify possible external institutions and are not claims of endorsement, provider compatibility or logo/trademark licensing. No externally hosted Plaid SDK source is bundled.

## Security and limitations

- Local browser files are not encrypted at rest; this app **does not write any transaction data to disk**, but your OS/browser and user-selected source files still require protection. Avoid use on untrusted/shared devices. Closing or refreshing clears app memory; no secure-memory-erase guarantee.
- On-screen masking does not prevent someone with access to browser memory or developer tools from reading imported data.
- CSV file size 2,000,000 bytes, max 10,000 rows each; max 20 files per selection, max 100,000 unique session rows, $1,000,000,000 per transaction.
- Multi-file imports fail atomically if validation of any file fails. All supported financial institutions remain **not connected**.
- Account labels are user-provided; do not use account numbers, usernames, or other sensitive identifiers.
- CSV values are rendered using `textContent` (no HTML injection). There is no export feature to accidentally create spreadsheet-formula injection.
- Browser tests, screen-reader testing, native device testing, independent threat review, encryption, audit logs, authorization, institution-specific file parsers, and sanctioned read-only OAuth/aggregator coverage are **not production-certified**.

## Required MIPS responsibilities

- **GoreeCloud UI:** governing visual tokens, accessibility and component acceptance (alpha reference only).
- **GoreeCloud Mesh:** proposed adapter boundaries and allowed read-only API scopes (not wired).
- **GoreeCloud Identity:** signed user/session authorization before any hosted backend (not wired).
- **GoreeShield:** consent, minimization, retention, revocation and private-data policy (local-only minimization implemented; no hosted policy engine).
- **Wardveil:** cybersecurity requirements, threat modeling, scanning and monitoring (not integrated).

## Future sequence

1. Review founder-approved UI tokens and screen-reader/visual acceptance.
2. Add a vetted bank-specific local CSV import profile only after examining a redacted, authorized sample and documented export semantics.
3. Keep this **public source repository** free of real financial data, account identifiers, secrets and statement exports. Never publish private data in tests or issues.
4. Verify each provider's lawful access model, product/account coverage, token scopes, consent, and revocation. Disabled until verified.
5. Independent security review and proper Identity/GoreeShield/Wardveil/Mesh integrations before hosted deployment.
