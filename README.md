# GoreeCloud Finances — read-only personal financial dashboard

**Maturity:** v0.6.0-alpha.0 development preview; **not** a production service or financial advice. Source includes a new local owner account and optional authorized Plaid adapter. No real banks have been linked or verified.

## Private owner dashboard (new)

Requires **Node.js 22+**. No npm install or third-party runtime packages are needed.

```sh
npm start
# Open http://127.0.0.1:8787/ on the same computer.
```

On first launch, **create your own username and password** for the GoreeCloud Finances app. The password encrypts the local vault; it is **not** a bank login. Sign in to see all seven institution cards and any account data you've linked or imported. Every app opening initiates a refresh check of existing connected providers; the UI reports the check time and how recently the upstream source says its data was updated.

**Live banking connections are not enabled by default.** A read-only Plaid Link adapter is available only when you supply your own authorized Plaid credentials and confirm the required product access, provider coverage, terms and costs. One-time institution authorization is attempted **per provider** where supported; not all providers or account types are guaranteed compatible. No banking password is stored by the app. Connections can be revoked from the dashboard. The hosted local mode stores imported CSV and provider tokens **encrypted at rest**.

See [setup, configuration, security and refresh behavior](docs/PRIVATE_DASHBOARD.md) and [Security policy](SECURITY.md).

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
