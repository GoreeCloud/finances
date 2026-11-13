# GoreeCloud Finances — source provenance and notices

The first-party application code is distributed under the MIT License in [LICENSE](LICENSE), Copyright (c) 2026 GoreeCloud.

## GoreeCloud UI token reference

The file `app/gc-tokens.css` is a small, selected alpha-stage token subset modeled on the GoreeCloud UI design-language source:

- Source: https://github.com/GoreeCloud/gc-ui
- Source license: MIT; Copyright (c) 2026 GoreeCloud, retained in the root LICENSE
- Authoritative design language is the separate `GoreeCloud/gc-ui` repository. The subset here is not a stable package or evidence of complete UI compliance.

## Excluded dependencies and provider marks

The Plaid JavaScript Link SDK is fetched from Plaid's own hosted CDN only after a deliberate user action; its code is **not** bundled in this repository. No provider API credentials or financial records are distributed.

Names such as Navy Federal Credit Union, Cash App, Varo, Capital One, Marcus by Goldman Sachs, Discover, and PayPal are used solely to identify possible data sources; no affiliation, endorsement, live integration, logo rights, or trademark license is claimed.

## License selection rationale

MIT was selected for the original, dependency-free application source after inspecting its file inventory for bundled third-party libraries and existing license obligations. The only known reused design reference is a GoreeCloud-owned MIT-licensed token subset. This is a targeted repository review, **not** a complete legal audit of future contributions, external SDKs, trademarks or deployment obligations. If new outside components are introduced, recheck license compatibility and preserve their notices.
