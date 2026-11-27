# BotanicaLab share API

Dependency-free Node.js service for the 3-day no-login share codes.

## Run

Direct:

```bash
PORT=4317 HOST=127.0.0.1 \
BOTANICALAB_SHARE_DATA=/mnt/data/botanicalab-share \
node /mnt/data/www/about/api/server.js
```

PM2 (user `xedryk`):

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

Environment variables:

- `PORT` (default `4317`)
- `HOST` (default `127.0.0.1`)
- `BOTANICALAB_SHARE_DATA` (default OS temp dir; keep outside web root)
- `ALLOWED_ORIGIN` (default `https://about.xedryk.top`)
- `SHARE_TTL_SECONDS` (default `259200` = 3 days)
- `SHARE_MAX_BYTES` (default `2097152`)
- `STATIC_DIR` + `SERVE_STATIC=1` only for local testing

## Caddy

See `Caddyfile.snippet`. Add it to the `about.xedryk.top` site block and reload Caddy.

## Security properties

- No account/login; an 8-character code plus a 4-digit PIN is the credential. A blank PIN on create is auto-generated and returned once in the QR.
- PINs are `scrypt`-hashed with a per-code random salt.
- Payloads are AES-256-GCM encrypted at rest with a 32-byte key stored outside the web root.
- Codes are hashed with SHA-256 before being used as storage filenames.
- Restricted CORS (same origin + localhost test ports), OPTIONS preflight, per-IP rate limit, PIN-attempt lockout, body-size cap, no-store headers.
- Expired records are deleted on every request and by a 60-second background timer.
- No payload or PIN is written to logs.
