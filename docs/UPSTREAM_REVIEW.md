# GoreeCloud Finances — targeted upstream integration review

**Review date:** November 13, 2026. **Scope:** public documentation and project metadata, plus the existing first-party GoreeCloud Finances source. This is **not** a complete upstream code/dependency, vulnerability, or license audit. No external runtime dependencies were added and no third-party source was copied.

## Plaid — API behavior and SDK consideration

- Official transactions integration: https://plaid.com/docs/transactions/
- Official mutation and paging failure semantics: https://plaid.com/docs/errors/transactions/
- Official API reference: https://plaid.com/docs/api/products/transactions/
- Official SDK reference: https://github.com/plaid/plaid-node

Plaid requires a full pagination replay starting with the previous saved cursor when TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION occurs. This informed the bounded, all-or-nothing restart in the existing first-party adapter. The API documents a maximum of 500 updates per sync page. Requests returning cached account data are not proof of a current bank refresh. On-demand Transactions refresh is separately billable and may be asynchronous. An owner-provided Plaid developer account, consent and eligible institution coverage are still necessary; no live credentials or account connections were evaluated here.

Decision: retain the small, allowlisted native fetch adapter for this development iteration. Evaluate the official Plaid SDK's current source, licenses, dependencies, security advisories, network behavior, maintenance and provider costs before any future adoption; this preliminary review does not claim those checks passed.

## Personal finance alternatives and design references

- Actual Budget: https://github.com/actualbudget/actual — MIT-licensed, local-first personal finance app and self-hosted sync architecture. Its budgeting and multi-device synchronization scope is broader than GoreeCloud Finances' current read-only private dashboard; consider its documentation and source architecture as references for later encrypted sync and reporting. No code imported. A full source/dependency security audit remains pending before reuse.
- Firefly III: https://github.com/firefly-iii/firefly-iii — AGPL-3.0 financial tracking and self-hosting reference. Its license carries stronger network-distribution obligations than a permissive dependency, and its budgeting features extend beyond the requested read-only account aggregation. No fork or code adoption; assess license and technical implications separately if deeper integration is considered.

## Reuse and trust decisions

- First-party GoreeCloud UI tokens already provide a vetted **alpha** token subset for this prototype; full design-language migration and device visual acceptance are not yet complete.
- GoreeCloud Identity, GoreeShield (privacy), Wardveil (cybersecurity), and Mesh (integration) remain authoritative but are not falsely represented as deployed in this local preview.
- Reuse the existing Node built-ins rather than installing an unreviewed npm package for key rotation, backup and transaction pagination. All new code is tested with synthetic data only.
- No live financial records, tokens, passwords, provider billing accounts, or third-party executable code were accessed or installed in this iteration.

## Follow-up acceptance gates

Before real provider onboarding or hosted use, verify bank-by-bank account coverage, consent, actual read-only scopes, costs, reconnect handling, webhook lifecycle, transaction reconciliation, encryption backup recovery, production isolation, dependency advisories, MIPS integration, threat review and independent browser/screen-reader testing. The absence of a scanned upstream package is not proof of safety or production readiness.

## v0.8 targeted Plaid update-mode review

Official Plaid guidance (https://plaid.com/docs/link/update-mode/) describes a token created with an existing Item access token, no products in the update-mode token request, and no repeated public-token exchange after Link success. The source-level adapter follows that request shape, checked with synthetic tests. This is not evidence of production OAuth/redirect registration, live user consent, account eligibility or bank freshness guarantees.


## v0.8 targeted open-source license decision

The existing public repository lacked a LICENSE file and was marked UNLICENSED in package metadata. The owner-governed licensing policy requires a repository-specific recognized open-source license. Its tracked source is first-party and dependency-free at runtime; the only known design-token subset is derived from MIT-licensed GoreeCloud UI source. MIT was adopted in the repository root with the 2026 GoreeCloud copyright holder and an explicit attribution NOTICE. This assessment is **specific to current source only**: new third-party libraries, branding assets, provider SDKs or imported sources require independent provenance and licensing review before inclusion. The public repository name and bank labels do not imply trademark authorization.


## v0.10 Plaid charge and refresh verification

Plaid documentation at https://plaid.com/docs/account/billing/ identifies per-request Balance and Transactions Refresh fee models, subject to the individual Plaid agreement. Transaction refresh information at https://plaid.com/docs/transactions/webhooks/ describes asynchronous provider updates and SYNC_UPDATES_AVAILABLE callbacks. This documentation informed the local fail-closed request-count gate. Actual product eligibility, account permissions, signed agreement, billing rates, webhooks and live provider availability were NOT checked and remain separate release gates.
