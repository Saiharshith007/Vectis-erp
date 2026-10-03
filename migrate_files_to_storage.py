#!/usr/bin/env python3
"""
One-time migration: copy files already stored in the Postgres `vectis_uploads`
table (as BYTEA blobs) into the Supabase Storage bucket.

It is SAFE to run more than once (it upserts; existing objects are overwritten)
and it does NOT delete anything from the database — that cleanup is a separate,
deliberate step you run only after verifying the app serves files from the bucket.

Required environment variables (the same ones your Render service uses):
    DATABASE_URL            postgres connection string
    SUPABASE_URL            e.g. https://xxxx.supabase.co
    SUPABASE_SERVICE_KEY    service_role key (secret)
    SUPABASE_BUCKET         e.g. vectis-files

Run it from a machine/shell that has those env vars set, e.g.:
    python migrate_files_to_storage.py
"""

import os
import sys
import urllib.parse
import urllib.request
import urllib.error

DATABASE_URL = os.environ.get('DATABASE_URL')
SUPABASE_URL = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY') or ''
SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET') or ''

if not (DATABASE_URL and SUPABASE_URL and SUPABASE_KEY and SUPABASE_BUCKET):
    print("ERROR: set DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY and SUPABASE_BUCKET first.")
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 is required. Run: pip install psycopg2-binary")
    sys.exit(1)


def storage_put(filename, data, mime):
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{urllib.parse.quote(filename)}"
    req = urllib.request.Request(url, data=bytes(data), method='POST', headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': mime or 'application/octet-stream',
        'x-upsert': 'true',
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status in (200, 201)


def main():
    conn = psycopg2.connect(DATABASE_URL)
    ok, fail = 0, 0
    try:
        # Fetch the list of filenames first, then stream each blob one at a time
        # so we never hold every PDF in memory at once.
        with conn.cursor() as cur:
            cur.execute("SELECT filename FROM vectis_uploads ORDER BY filename;")
            names = [r[0] for r in cur.fetchall()]

        print(f"Found {len(names)} file(s) in vectis_uploads. Migrating to '{SUPABASE_BUCKET}'...\n")
        for i, name in enumerate(names, 1):
            with conn.cursor() as cur:
                cur.execute("SELECT data, mime_type FROM vectis_uploads WHERE filename = %s;", (name,))
                row = cur.fetchone()
            if not row or row[0] is None:
                print(f"  [{i}/{len(names)}] SKIP (no data): {name}")
                continue
            data, mime = row[0], row[1] or 'application/octet-stream'
            try:
                storage_put(name, data, mime)
                ok += 1
                print(f"  [{i}/{len(names)}] OK   {name}  ({len(bytes(data))} bytes)")
            except urllib.error.HTTPError as e:
                fail += 1
                body = e.read().decode('utf-8', 'replace')[:200]
                print(f"  [{i}/{len(names)}] FAIL {name}  HTTP {e.code}: {body}")
            except Exception as e:
                fail += 1
                print(f"  [{i}/{len(names)}] FAIL {name}  {e}")
    finally:
        conn.close()

    print(f"\nDone. Uploaded {ok}, failed {fail}.")
    if fail == 0 and ok > 0:
        print("All files are now in the bucket. Verify the app, then run the DB cleanup step.")


if __name__ == '__main__':
    main()
