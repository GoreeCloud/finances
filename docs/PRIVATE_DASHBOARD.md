# Private dashboard — v0.10.0-alpha.0

## Creating and using your account

Run `npm start` using Node.js 22 or later and open `http://127.0.0.1:8787/` on the same computer. The service binds **only** to loopback, not your LAN or the Internet.

At first launch, choose your own local username (3–32 allowed characters) and a **unique password of at least 12 characters**. This password unlocks and encrypts your local vault; it is **not** a bank password. The password is scrypt-derived (N=32768, r=8, p=1), and your financial records and Plaid access tokens are stored using AES-256-GCM with owner-only file permissions. The username and encryption metadata remain visible in the vault header. Sessions are in memory, with HttpOnly SameSite=Strict cookies, a 30-minute idle limit and a 12-hour absolute limit. Restarting the service requires signing in again.

Signed-in owners may change their vault password under the security section of the dashboard. The operation requires the current password, re-encrypts existing state using a fresh salt, revokes prior sessions, and creates a new active session.

An encrypted backup and restore workflow exists, but there is no lost-password recovery or multi-user support. **Losing your password makes encrypted data inaccessible, even with an encrypted backup.** Use a password manager and preserve protected backups of the encrypted vault where appropriate. The default vault path is `~/.local/share/goreecloud-finances/vault.json`; for testing, override it using `GOREE_FINANCES_DATA_FILE`. This file must never be committed to GitHub.

## Local ciphertext-only backups and restore

To create an encrypted backup from the local owner vault, run:

~~~sh
npm run vault:backup
~~~

By default, sealed ciphertext is copied into ~/.local/share/goreecloud-finances/backups/ outside the repository. Only mode-0600 regular source files and private mode-0700 destination directories are accepted. The script never decrypts data or exports secrets. For a nonstandard data file use GOREE_FINANCES_DATA_FILE; to choose a nondefault private backup directory outside Git repositories use GOREE_FINANCES_BACKUP_DIR.

To restore into a **new/empty vault**, stop the local server, verify that the target vault does not exist and run:

~~~sh
npm run vault:restore -- /absolute/path/to/saved-backup.encrypted.json
~~~

Restore refuses overwriting existing vaults. The original password used when the snapshot was taken is still required. Backups made before a password change remain encrypted under the older password. The tool validates format and permission boundaries, not cryptographic integrity: signing in after restore verifies the encryption tag. Never put encrypted backups or financial data in a public repository.

## One-time provider setup

The private dashboard runs without live connections. For Plaid linking, obtain your **own, authorized** API credentials and separately verify provider coverage, account eligibility, terms and any fees:

```bash
GOREE_PLAID_ENV=sandbox
GOREE_PLAID_CLIENT_ID=YOUR_CLIENT_ID
GOREE_PLAID_SECRET=YOUR_SECRET
npm start
```

Use an appropriate protected local secret manager or runtime configuration to set those variables. **Do not commit credentials or real financial data.** Sandbox credentials are for synthetic testing, not live accounts.

On each of the seven institution cards, select **Connect account**. The official Plaid Link interface manages provider authorization and consent; GoreeCloud Finances itself never receives the bank password. The account authorization must generally be performed **once per supported institution**, although a single institution link may include several accounts. Your app username/password is shared across your entire local dashboard, not used as a bank login. Provider compatibility for Navy Federal Credit Union, Cash App, Varo, Capital One, Marcus by Goldman Sachs, Discover and PayPal has **not been verified for your specific accounts**. Some will require manual imports or later provider-specific adapters. Provider reconnection or re-consent may occasionally be necessary.

### Reconnecting without repeating onboarding

Each connected Item has **Renew access** (or **Reconnect** when the last refresh failed). This opens [Plaid Link update mode](https://plaid.com/docs/link/update-mode/) using an Item-specific link token created with the **existing server-held access token**. The bank may require you to sign in and renew consent within Plaid's provider authorization window. The application does not ask for, store, or exchange an additional public token during the update flow. After the official Link success callback, the server verifies the *same institution ID and matching institution name* and attempts a bounded read-only sync. If that sync fails, the previous encrypted data stays and an error is shown. The app's login password is still separate.

**Limits:** The sandbox mock tests prove local request shape and state handling, not real OAuth eligibility or consent completion. Some OAuth institutions require registered HTTPS redirect URIs that this loopback-only alpha **does not configure**. Not all seven providers or account types can necessarily be linked through Plaid. Do not treat the Reconnect button as proof of institution support.

To stop access, click **Disconnect**, which calls Plaid's `item/remove` and removes the linked data from the encrypted vault. Manual CSV imports remain separate.

## Refresh on every opening

After unlocking your dashboard, the app immediately reads saved data and **initiates a new check** against each connected provider (up to three checks concurrently). Page reloads do the same. The **Check for updates** button can run another check at any time. Every card distinguishes a check timestamp from Plaid's reported upstream update timestamp. If an API check fails, saved data remains with an error indicator; the app does not silently claim it is current.

By default the Plaid account/transaction read endpoints serve cached data. Checking on app opening does NOT force the financial institution to publish new records.

### Optional separately billed on-demand calls

To permit optional fee-bearing requests, after independently reviewing your approved Plaid product access, actual fees, your agreement and consent, configure both request-count limits as well as the specific paid product flags. This is an illustration of settings, NOT a request to enable real billing:

~~~bash
GOREE_PLAID_REALTIME_BALANCE=true
GOREE_PLAID_TRANSACTION_REFRESH=true
GOREE_PLAID_PAID_DAILY_CAP=4
GOREE_PLAID_PAID_PER_ITEM_DAILY_CAP=2
~~~

Both caps must be positive integers 1–100; the per-Item daily cap must not exceed the global daily cap. The caps apply to all optional paid operations COMBINED in a rolling 24-hour window. A 30-minute per-Item/operation cooldown also applies. Missing, malformed or insufficient caps always disable paid operations; ordinary cached checks continue.

A private on-disk request journal defaults to ~/.local/share/goreecloud-finances/paid-requests.json. You may configure GOREE_PLAID_PAID_LEDGER_FILE to a trusted private absolute path OUTSIDE source control. The journal has restrictive owner-only permissions (0600 file, 0700 directory) and stores only pseudonymized keyed Item digests, operation types and timestamps, NEVER raw bank tokens, transaction descriptions or balances. It is NOT part of the encrypted financial vault and is not encrypted itself. An atomic, fsynced record is written before each optional paid request, under a cross-process exclusive lock. Failed or uncertain provider calls still count to avoid automatic repeat charges.

The program fails closed when the ledger is malformed, has broad permissions, is a symlink, is locked by another process, or the system clock moves backward. A crash may leave a stale lock file; before any manual recovery, stop all application processes and verify no legitimate writer is still using the journal. The application does not automatically remove suspected stale locks, reset the budget or call paid endpoints on a fallback. Provider cards display notices about skipped/failed optional calls. The cached provider checks remain operational.

**Important limits:** This is a local *request-count* restriction, NOT a dollar-cost ceiling, legally enforceable budget, or total Plaid billing guarantee. Deleting/replacing/migrating the journal loses its history. Requests by another client or on another host are not accounted for. The owner's actual pricing depends on their Plaid agreement; Transactions Refresh may update asynchronously, so a check is not a freshness guarantee. Obtain explicit owner authorization and real provider coverage, webhook, security, billing and recovery acceptance before production use.

Plaid references: https://plaid.com/docs/account/billing/ and https://plaid.com/docs/transactions/webhooks/

## Offline import fallback

Provide a UTF-8 CSV with the exact normalized header `date,description,amount`. Dates use `YYYY-MM-DD`, dollar amounts have at most two fractional digits, positive = inflow and negative = outflow. Never use actual account numbers for user-defined nicknames. Imports are parsed on the loopback server, converted to integer cents and encrypted at rest. They do not represent verified official balances.

## Stored-transaction search and pagination

The signed-in dashboard now shows a **Stored transactions** section. Type a merchant, description or account term, select an institution, choose a source (imported CSV or connected provider), or set inclusive date boundaries. Filters combine. Choose **Clear filters** to return to the full locally stored record set. Use **Show 50 more** to progressively load matching rows rather than downloading the entire vault history into the browser.

Only records already present in your local encrypted vault are searched. The authenticated, CSRF-guarded, POST-only API route /api/transactions accepts query, institution, source, start, end, page and pageSize (1–100), returns rows, total, totalStored, page, pageSize and hasMore, and rejects invalid filters. A first-page query defaults to 50 rows. The overview no longer sends a 200-transaction preview; it returns only account summaries and counts. Your search terms are in the request body, **not URL parameters** or browser storage. HTTP responses set Cache-Control: no-store.

The total reflects locally stored entries, not complete bank history. Plaid may still deliver delayed/cached updates, each connection is capped at 10,000 transaction records in this development alpha, and cross-source CSV/provider overlap is not fully reconciled. Search pagination is per-request, not a transactional immutable snapshot: if a refresh changes history while you are browsing later pages, repeat the search to get a fresh result. No full historical export, cloud sync or production guarantee is provided.

## Statement duplication semantics

The CSV importer preserves all distinct occurrence ordinals within a normalized file, and an overlapping reimport adds only genuinely new occurrence keys. For example, if the first export has two identical dated $5 transactions and a later overlapping export has three, the vault retains three—not two or five. Exact-match idempotence is not a substitute for official bank transaction IDs or deterministic reconciliation of different export formats. Imported entries and live provider entries are presented with their source labels; duplicate real-world spending across those sources can still be counted twice. Never treat this as a reconciled ledger or a complete account balance.

## Security and deployment limits

The implementation uses Node built-ins and the existing strict CSV parser; there are no npm runtime dependencies. Link's JavaScript SDK is loaded from `cdn.plaid.com` **only after clicking Connect**, and communicates externally under Plaid's terms. No CORS, analytics, payments or transfers are present. The loopback app has CSRF/Origin/Host validation, rate-limited login, no-store responses and restricted imports, but has **not** undergone a full independent security audit. **Do not publicly expose this loopback app, port-forward it, or put it behind an unaudited reverse proxy.** A safe remote/Android deployment requires a separate threat model, HTTPS and verified GoreeCloud Identity, GoreeShield, Wardveil and Mesh integration.

The original `app/index.html` remains available as a completely offline, in-memory-only CSV viewer with no app login and no persistent vault.
