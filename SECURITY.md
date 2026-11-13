# Security policy — GoreeCloud Finances

GoreeCloud Finances is a **read-only, local-first development preview**, not a bank-approved or production-hardened financial service. This public repository contains source and synthetic tests only.

Never post real transaction exports, bank credentials, account numbers, app passwords, OAuth tokens, vulnerability details or private environment variables to GitHub, GitHub Actions, public issues, screenshots or logs. Use GitHub private vulnerability reporting when available.

## Verified in automated tests

- Local username/password account protected by scrypt and an AES-256-GCM encrypted vault with owner-only filesystem permissions.
- HttpOnly, SameSite=Strict, in-memory limited sessions, CSRF request headers, Origin and Host validation, login attempt throttling, bounded import requests and safely escaped browser text insertion.
- Allowlisted Plaid API operations for Link, account data, transaction sync, optional separately enabled refresh/balance, and item removal. **No transfers or payments**.
- Unverified bank coverage stays unconnected. The official Link SDK, when configured, handles external provider consent; GoreeCloud Finances does not accept bank credentials.

## Limitations

The server binds to loopback only. **Do not reverse proxy or port-forward** without a separate security architecture, HTTPS, hardened authentication, rate limits, session protection, and an independent threat review. In this preview, sessions and password-derived keys exist in process memory, the local username is in the plaintext vault header, and password recovery/rotation is not available. Shared or infected endpoints, malicious extensions, local privileged users, filesystems/backups and network configuration can still compromise data. Password loss means encrypted vault loss without a secure backup.

Third-party provider calls do not guarantee fresh bank data. Optional on-demand APIs may incur provider fees. The early Plaid adapter and browser flow are not end-to-end verified against actual bank accounts or eligible production credentials. Signed-in state is local only, not an integration with GoreeCloud Identity. Formal GoreeShield and Wardveil integration, webhooks, independent penetration testing and production authorization are pending.

See [Private dashboard](docs/PRIVATE_DASHBOARD.md) and [Architecture](docs/ARCHITECTURE.md).
