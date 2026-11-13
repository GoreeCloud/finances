# Private dashboard — v0.6.0-alpha.0

## Creating and using your account

Run `npm start` using Node.js 22 or later and open `http://127.0.0.1:8787/` on the same computer. The service binds **only** to loopback, not your LAN or the Internet.

At first launch, choose your own local username (3–32 allowed characters) and a **unique password of at least 12 characters**. This password unlocks and encrypts your local vault; it is **not** a bank password. The password is scrypt-derived (N=32768, r=8, p=1), and your financial records and Plaid access tokens are stored using AES-256-GCM with owner-only file permissions. The username and encryption metadata remain visible in the vault header. Sessions are in memory, with HttpOnly SameSite=Strict cookies, a 30-minute idle limit and a 12-hour absolute limit. Restarting the service requires signing in again.

There is no password recovery/rotation, encrypted backup workflow or multi-user support yet. **Losing your password makes encrypted data inaccessible.** Use a password manager and preserve protected backups of the encrypted vault where appropriate. The default vault path is `~/.local/share/goreecloud-finances/vault.json`; for testing, override it using `GOREE_FINANCES_DATA_FILE`. This file must never be committed to GitHub.

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

To stop access, click **Disconnect**, which calls Plaid's `item/remove` and removes the linked data from the encrypted vault. Manual CSV imports remain separate.

## Refresh on every opening

After unlocking your dashboard, the app immediately reads saved data and **initiates a new check** against each connected provider. Page reloads do the same. The **Check for updates** button can run another check at any time. Every card distinguishes a check timestamp from Plaid's reported upstream update timestamp. If an API check fails, saved data remains with an error indicator; the app does not silently claim it is current.

By default, `/accounts/get` returns **cached balances** and `/transactions/sync` reads Plaid's incrementally updated transaction feed. A request at app opening does **not** force banks to publish new information. The separately billed on-demand capabilities can be enabled only if your Plaid plan has the necessary permissions and you accept the possible fees:

```bash
GOREE_PLAID_REALTIME_BALANCE=true
GOREE_PLAID_TRANSACTION_REFRESH=true
```

**Warning:** Either flag can incur additional fees *per connected account/check*. The transaction refresh API may return before new data is ready. For robust production synchronization, add rate control, approved webhooks, coverage checks and explicit billing safeguards. These flags are disabled by default.

## Offline import fallback

Provide a UTF-8 CSV with the exact normalized header `date,description,amount`. Dates use `YYYY-MM-DD`, dollar amounts have at most two fractional digits, positive = inflow and negative = outflow. Never use actual account numbers for user-defined nicknames. Imports are parsed on the loopback server, converted to integer cents and encrypted at rest. They do not represent verified official balances.

## Security and deployment limits

The implementation uses Node built-ins and the existing strict CSV parser; there are no npm runtime dependencies. Link's JavaScript SDK is loaded from `cdn.plaid.com` **only after clicking Connect**, and communicates externally under Plaid's terms. No CORS, analytics, payments or transfers are present. The loopback app has CSRF/Origin/Host validation, rate-limited login, no-store responses and restricted imports, but has **not** undergone a full independent security audit. **Do not publicly expose this loopback app, port-forward it, or put it behind an unaudited reverse proxy.** A safe remote/Android deployment requires a separate threat model, HTTPS and verified GoreeCloud Identity, GoreeShield, Wardveil and Mesh integration.

The original `app/index.html` remains available as a completely offline, in-memory-only CSV viewer with no app login and no persistent vault.
