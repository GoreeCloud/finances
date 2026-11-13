# GoreeCloud Finances — architecture and trust boundaries

The repository has two separate development paths: the original `app/` is an offline v0.5.0 in-memory CSV viewer; the new `server/` and `web/` together provide a v0.8.0-alpha.0 **loopback-only** encrypted single-owner dashboard with account login, password rotation, ciphertext backup/restore, and optional Plaid integration.

- `server/main.mjs`: loopback startup only, Node.js 22+.
- `server/app.mjs`: same-origin authenticated API, session and CSRF/Origin/Host checks, login rate limits, request size bounds, local static UI, imported statement handling, account cards and refresh-on-open endpoint.
- `server/vault.mjs`: password-derived scrypt key, AES-256-GCM encrypted state, atomic owner-only persistent vault, no decrypted files.
- `server/plaid.mjs`: provider-authorized Link token exchange; provider institution verification via official item/institution APIs; account and incremental transaction read; item removal. Paid on-demand balance/transaction refresh only with explicit environment opt-in. Explicit endpoint allowlist contains **no payment or transfer operations**.
- `web/`: responsive GoreeCloud UI alpha-token-based authenticated dashboard; native form controls, safe text-node rendering, contextual freshness indicators, amount masking, search, local CSV import and connected-account revocation.
- `app/finance.js`: reused strict normalization, integer-cent parser and occurrence-aware duplicate detection. All CSV imports remain locally encrypted in hosted mode.

Seven intended provider categories: Navy Federal Credit Union, Cash App, Varo, Capital One, Marcus by Goldman Sachs, Discover and PayPal. Their live support is **not guaranteed**. Linking is per institution where permitted, and OAuth/consent may need renewal. A fresh sync check is **not** equivalent to a fresh bank-data timestamp. Cached balances and actual upstream update times are clearly distinguished.

### Governance and production boundary

- **GoreeCloud UI**: subset of central alpha tokens used; full acceptance pending.
- **GoreeCloud Mesh**: adapter boundary prepared; no verified deployed Mesh service integration.
- **GoreeCloud Identity**: local owner sign-in implemented; no Identity federation or production auth platform integration.
- **GoreeShield**: source minimization and local retention implemented in part; centralized consent/retention governance not yet integrated.
- **Wardveil**: baseline code hardening and tests only; no integrated scanning/incident monitoring or independent audit.

Not implemented: multi-user, forgotten-password recovery, production-safe remote access, OAuth re-link update mode, provider webhook receiver, full transaction reconciliation, platform-native Android app, commercial availability and provider-specific statement parsing. No live banking accounts were linked or verified for this work. The product is a development preview, not Anchor or production.

See [Local private dashboard](PRIVATE_DASHBOARD.md) and [Security](../SECURITY.md).


## v0.7 security and synchronization changes

- The vault can rotate its password after re-verifying the current password. This decrypts and re-encrypts all state with a fresh salt, writes an atomic replacement, and revokes older sessions. Stale keys are rejected for writes.
- A local backup CLI copies the sealed encrypted vault into a private destination without reading plaintext. Restore refuses to overwrite any existing vault. Backups still require the corresponding password for decryption.
- Plaid sync restarts from the original cursor on transaction mutation during pagination, never committing partial batches. Up to three attempts are made. Paid on-demand requests have a per-item 30-minute cooldown tracked in process memory and (on successful sync) encrypted state. It is not a production billing cap.
- Tests cover rotation, backup/restore, permission and symlink refusal, pagination restart and paid cooldown. Formal browser, accessibility, independent security and production provider validation remain incomplete.


## v0.8 incremental improvements (synthetic-source validation)

- The CSV importer saves exact new rows returned by the occurrence-aware canonical merge rather than discarding additional equal-value occurrences.
- Refresh uses three bounded parallel read-only workers, then one encrypted vault commit. Failures retain previous data and show their own check timestamp.
- Plaid Link update mode uses an existing encrypted access token and requests no new products; the browser never exchanges a new token for an existing Item. Server validations check linked Item ownership and unchanged institution ID/name before a read-only check.
- Synthetic regression tests cover overlapping imports, connection isolation, update-mode token shape, identity mismatch and bounded parallel error-preserving checks. No live bank connections, production OAuth redirects, or provider coverage verified.
