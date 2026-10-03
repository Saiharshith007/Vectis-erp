# Deployment

Vectis is a single Python process serving both the UI and the API. Out of the
box it listens on `127.0.0.1:8000` over plain HTTP, which is fine on your own
machine and nowhere else. Pick one of the setups below before anyone else
connects to it.

## Before you go live

- Set `VECTIS_ADMIN_EMAIL` to a real address and change the default
  `admin123` password (profile menu → Change password).
- Remove any test accounts from User Management.
- Set up backups of `db/` (or of your Postgres database).

## How HTTPS is decided

On start, `server.py` looks for `certs/cert.pem` and `certs/key.pem` (or the
paths in `VECTIS_CERT` / `VECTIS_KEY`):

- **Found**: serves HTTPS on all interfaces, port 443 by default, and marks the
  session cookie `Secure`.
- **Not found**: serves HTTP on localhost only and prints a warning.

Behind a reverse proxy, leave `certs/` empty and let the proxy terminate TLS.
The app trusts `X-Forwarded-Proto: https` from the proxy to set the `Secure`
cookie flag.

## Linux VM behind Caddy (recommended for internet access)

Caddy gets and renews a Let's Encrypt certificate on its own, so there is no
certificate maintenance.

1. Copy the app to `/opt/vectis` and create a `vectis` user that owns it.
2. Install the unit file and start it:

   ```bash
   sudo cp deploy/vectis.service /etc/systemd/system/
   sudo systemctl enable --now vectis
   ```

   It binds to `127.0.0.1:8000`, so only Caddy can reach it.
3. Install Caddy, put your domain into `deploy/Caddyfile`, copy it to
   `/etc/caddy/Caddyfile` and reload Caddy. DNS for the domain must point at
   the VM.
4. Firewall: only 80 and 443 open to the world, SSH ideally limited to your IP.

   ```bash
   sudo ufw default deny incoming
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```

   On a cloud provider, mirror this in the provider's firewall too. Never open
   port 8000.

Nginx works just as well: proxy to `http://127.0.0.1:8000` and pass
`X-Forwarded-Proto`.

## Windows PC on an office network

For a handful of users on the same LAN.

```powershell
python make_cert.py your-pc-name   # needs: pip install cryptography
python server.py
```

`run_https.bat` does both steps. A self-signed certificate encrypts the traffic
but browsers will warn that it isn't trusted; that's acceptable on a LAN, not on
a public site.

Restrict who can reach it (run as Administrator):

```powershell
# only machines on the local subnet
powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1 -Mode Lan

# or only this PC
powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1

# undo
powershell -ExecutionPolicy Bypass -File .\harden-firewall.ps1 -Remove
```

To keep it running across reboots, install it as a service with
[NSSM](https://nssm.cc/):

```powershell
nssm install Vectis "C:\Path\To\python.exe" "C:\vectis\server.py"
nssm set Vectis AppDirectory C:\vectis
nssm start Vectis
```

### Public site straight from Windows

Possible, but you have to manage the certificate yourself. Get a Let's Encrypt
certificate with [win-acme](https://www.win-acme.com/) (or use one from your
provider), save it as `certs/cert.pem` and `certs/key.pem`, forward ports 80 and
443 on the router, and renew every 90 days. Running Caddy on the same machine
avoids the renewals.

Home connections often block 80/443 or sit behind CGNAT, and the site goes down
whenever the PC does. A small VM is usually less trouble.

## Render

`render.yaml` is a ready-made blueprint.

- **Set `DATABASE_URL`.** Render's disk is wiped on every deploy, so without
  Postgres all data is lost. The server logs a loud warning if it's missing.
- Optionally set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (the service_role key)
  and `SUPABASE_BUCKET` to keep PDFs and uploads in object storage instead of
  the database. `migrate_files_to_storage.py` copies existing files from
  Postgres into the bucket.
- If you use Postgres anywhere, don't expose port 5432 publicly. The app forces
  `sslmode=require` on the connection.

## Backups

With file storage, everything lives in `db/` (and uploaded files in
`uploads/`).

```powershell
# zip db/ into backups\, keeping the latest 30
powershell -ExecutionPolicy Bypass -File .\backup-db.ps1
powershell -ExecutionPolicy Bypass -File .\backup-db.ps1 -Keep 60 -Dest "D:\VectisBackups"
```

Schedule it in Task Scheduler and copy the backups off the machine now and
then. On Linux, a cron job running `tar` over `db/` does the same. With
Postgres, use `pg_dump`.
