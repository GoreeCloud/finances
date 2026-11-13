# GoreeCloud Finances — architecture and trust boundaries

## Implemented: disconnected v0.5.0 prototype

The application is static HTML, CSS and JavaScript with no third-party runtime libraries. The pure parser and exact-cent aggregation functions live in app/finance.js; app/main.js handles in-memory imported records and safe text-only DOM rendering. app/core.py is a separate Python validation reference. The mesh-reference module is a fail-closed **illustration**, not a real integration.

Data flow: **user-selected normalized CSV** → strict UTF-8 and CSV validation → in-memory transaction records → client-side filters and summaries → manually clear or refresh. No real-account data, credentials, network connectors or persistent transaction stores are included.

The seven disconnected institution *labels* are Navy Federal Credit Union, Cash App, Varo, Capital One, Marcus by Goldman Sachs, Discover and PayPal. OAuth/API/aggregator eligibility has not been verified for any of them.

Signed amount conventions: positive means inflow, negative means outflow. Movement is not an account balance, the entire set may be incomplete, and identical rows across statement exports may be ambiguous.

## Proposed future design — not connected or implemented

- **GoreeCloud Mesh**: institution-specific, provider-authorized adapters permitting reads only after actual capability verification.
- **GoreeCloud Identity**: authenticated, least-privilege server-side access to any future private instance.
- **GoreeShield**: consent, collection minimization, retention and revocation.
- **Wardveil**: cybersecurity controls, credential protection, scanning and response.
- **GoreeCloud UI**: authoritative visual tokens, accessibility, theme and platform testing.

Read-only restrictions must be enforced in backend code and actual provider scopes, **not merely hidden buttons**. A hypothetical hosted backend and provider credentials must remain private, outside this public prototype, pending review.

## Threat assumptions

A compromised browser, extension, OS or shared computer may reveal imported content. Source CSV files and OS/browser caches can persist independently of this application. Parsing is bounded but has not had a complete independent security audit. Test fixtures contain synthetic examples only. No provider has approved this code as a banking integration.
