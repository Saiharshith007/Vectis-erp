# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private reporting instead
(**Security → Report a vulnerability** on this repository) and include steps to
reproduce. I'll acknowledge it as soon as I can.

## How the app protects data

- Every data endpoint requires a server-side session. Sessions use an
  `HttpOnly`, `SameSite=Strict` cookie with a 30-minute idle timeout and a
  12-hour hard limit.
- Only users approved by the admin can sign in. User and settings changes are
  admin-only, and the activity log is append-only for non-admins.
- Passwords are stored with salted PBKDF2-HMAC-SHA256 (240k iterations).
- Repeated failed logins from the same IP and account are throttled.
- `db/`, `uploads/`, `certs/`, source and config files are never served as
  static files; paths are resolved before the check, so URL-encoding tricks
  don't get around it. Uploads are restricted to an allow-list of document and
  image types.
- Server-side writes (PDF and backup save paths) can't land inside the app
  directory or system folders.
- Responses carry CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` and, over HTTPS, HSTS. POST bodies are capped at 60 MB.
- Secrets in settings (such as the SMTP password) are never sent to the
  browser.

## What's on you

- **Change the default admin password.** `admin123` is in this README.
- Serve it over HTTPS before it leaves your machine; see
  [docs/deployment.md](docs/deployment.md).
- Expose only ports 80/443. Keep the app on `127.0.0.1` behind a proxy.
- Keep `db/` backed up, and the disk encrypted if the machine could walk off.
- Admins can choose where PDFs and backups are written on the server. Only give
  admin rights to people you trust, and set `VECTIS_SAVE_ROOTS` to fence those
  writes in.
