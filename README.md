# Vectis

Self-hosted invoicing and document management for small accounts teams.
Purchase orders, quotations, proforma and tax invoices, receipts and credit
notes, all exported as PDF. One Python file on the backend (standard library
only), plain JavaScript on the front.

It's built around Indian GST invoicing: CGST/SGST/IGST, GSTIN on documents and
April–March financial years, with foreign-currency invoices for export clients.

## Features

- Purchase orders, quotations, proforma invoices and tax invoices with PDF export
- Received client POs: upload the PDF, capture the line items, and invoice
  against it in parts
- Receipts, sales register, sales returns / credit notes and a yearly summary
- Domestic (INR + GST) and international (multi-currency, SWIFT bank details)
  documents
- Automatic numbering per financial year, with editable starting serials
- Bulk import of clients, suppliers and past invoices from CSV or Excel
- Sign-up with admin approval, plus an activity log

## Quick start

Needs Python 3 (3.11 is what it's run on). Nothing to install for local use.

```bash
git clone https://github.com/<your-username>/vectis.git
cd vectis
python server.py
```

Open http://127.0.0.1:8000 and sign in as `admin@example.com` with password
`admin123`. Change the password right away (profile menu → Change password);
the server prints a warning on every start until you do.

On Windows you can double-click `run.bat` instead (it uses port 8010 and opens
the browser). On macOS/Linux there's `./run.sh`.

Data is kept as JSON files in `db/`. Set `DATABASE_URL` to use PostgreSQL.

## Making it yours

- **Company details**: Settings → Company Header. Name, address, GSTIN, CIN,
  phone, email and website are printed on every PDF. Set the GSTIN before
  invoicing: its state code is what decides CGST+SGST (same state as the
  client) versus IGST.
- **Logo on documents**: upload it in the same Company Header form. It prints
  top-right on invoices, quotations, POs, receipts and reports. Any shape works;
  a wide PNG with a transparent background looks best. Without one, documents
  print with no logo. (`logo.svg` is the Vectis app logo in the top bar and
  login page, and never appears on documents.)
- **Document number prefix**: `ORG_CODE` at the top of `js/storage.js`. The
  default `ORG` gives numbers like `ORG/0001/2627`.
- **Departments**: the `DEPARTMENTS` lists in the `js/` modules.
- Signatures, GST rates, bank accounts and serial numbers are all in Settings.

### Email verification (optional)

New users can be asked to confirm their email with a one-time code. Add your
SMTP details to `db/app_settings.json`:

```json
{
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "smtpUser": "no-reply@example.com",
  "smtpPassword": "...",
  "smtpFromName": "Vectis"
}
```

Without them, sign-up skips the code and goes straight to admin approval.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `VECTIS_ADMIN_EMAIL` | `admin@example.com` | Admin login |
| `VECTIS_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` when TLS or `PORT` is set) |
| `VECTIS_PORT` / `PORT` | `8000` | Listen port (`443` when a certificate is present) |
| `DATABASE_URL` | unset | PostgreSQL connection string; needs `pip install -r requirements.txt` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | unset | Keep uploaded and generated files in a Supabase Storage bucket |
| `VECTIS_CERT`, `VECTIS_KEY` | `certs/cert.pem`, `certs/key.pem` | Serve HTTPS directly when both exist |
| `VECTIS_SAVE_ROOTS` | unset | Only allow server-side PDF/backup writes inside these folders |
| `VECTIS_UPLOAD_EXTS` | pdf, images, office files, csv, txt | Allowed upload extensions |

Login throttling and POST rate limits can be tuned with `VECTIS_LOCK_*` and
`VECTIS_POST_RATE_*` (see `server.py`).

## Deployment

[docs/deployment.md](docs/deployment.md) covers running it on a Windows PC for
an office LAN, on a Linux VM behind Caddy, and on Render with Postgres. Read
[SECURITY.md](SECURITY.md) before exposing it to the internet.

## Project layout

```
server.py         HTTP server, auth, sessions, persistence
index.html        the single-page UI
js/               one module per screen, plus storage, auth and PDF helpers
css/styles.css
deploy/           Caddyfile and systemd unit
run.bat, run.sh   local launchers
*.ps1             Windows backup and firewall helpers
```

## Tests

```bash
python test_server_logic.py
```

## License

[MIT](LICENSE)
