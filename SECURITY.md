# Security policy — GoreeCloud Finances

This public repository contains a **local-only, read-only development prototype**. No live bank connector, saved token, remote account login or payment API is included.

**Never publish real account data** in an issue, pull request, discussion, build log, test fixture, screenshot or attachment. Use synthetic reproductions only. Do not enter passwords, MFA codes, payment information, account numbers or OAuth secrets into this prototype.

## Current boundaries

- Browser CSP denies outbound network connections, form submissions, frames, fonts, objects and external assets.
- File imports require explicit local selection, and transactions exist in application memory only.
- The Mesh sample denies all live calls; it is **not** a production authorization gate.
- On-screen masking is not encryption. Source files, browsers, extensions, operating-system caches, backups and memory can expose data beyond the app's control.

## Reporting

Use GitHub private vulnerability reporting when available, or a trusted private contact route. Do not open public reports containing sensitive transactions, exploits or credentials.

A secure hosted product requires independent security review, verified banking scopes, authenticated server-side authorization, consent and retention controls, and incident response. This source is not financial advice.
