import os
import sys
import json
import base64
import re
import ssl
import secrets
import hashlib
import hmac
import gzip
import urllib.request
import urllib.error
import urllib.parse
import time
import smtplib
import datetime
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# PostgreSQL support for cloud deployments (e.g. Render.com)
_DB_POOL = None
_IMPORT_ERROR = None
try:
    import psycopg2
    from psycopg2.pool import ThreadedConnectionPool
except ImportError as e:
    psycopg2 = None
    ThreadedConnectionPool = None
    _IMPORT_ERROR = str(e)

# OTP store: email -> {code, expires, regData}
_OTP_STORE = {}
OTP_TTL = 600  # 10 minutes

# ──────────────────────────────────────────────────────
#  Helpers
# ──────────────────────────────────────────────────────

DB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'db')

# PostgreSQL pool initialization
_DB_VERSION = int(time.time() * 1000)
_DATABASE_URL = os.environ.get('DATABASE_URL')
if _DATABASE_URL:
    if not ThreadedConnectionPool:
        print(f"[DB] [WARNING] DATABASE_URL is set, but psycopg2 library failed to load! Falling back to local files. Import error: {_IMPORT_ERROR}", flush=True)
    else:
        try:
            # Enforce SSL for cloud databases (like Supabase or Neon.tech) if not specified
            if "sslmode=" not in _DATABASE_URL:
                if "?" in _DATABASE_URL:
                    _DATABASE_URL += "&sslmode=require"
                else:
                    _DATABASE_URL += "?sslmode=require"

            # Redact password for safe logging
            redacted_url = _DATABASE_URL
            try:
                if "@" in _DATABASE_URL:
                    prefix, suffix = _DATABASE_URL.split("@", 1)
                    # Find scheme and credentials
                    scheme_creds = prefix.split("://", 1)
                    if len(scheme_creds) == 2:
                        scheme, creds = scheme_creds
                        redacted_url = f"{scheme}://{creds.split(':', 1)[0]}:[REDACTED]@{suffix}"
            except Exception:
                redacted_url = "[URL parsing failed for redaction]"

            print(f"[DB] Attempting to connect to PostgreSQL at: {redacted_url}", flush=True)

            # We use minimum 1, maximum 20 connections in the threaded pool
            _DB_POOL = ThreadedConnectionPool(1, 20, _DATABASE_URL)
            # Verify connection and verify/create tables
            _conn = _DB_POOL.getconn()
            try:
                with _conn.cursor() as _cur:
                    _cur.execute("""
                        CREATE TABLE IF NOT EXISTS vectis_db (
                            key VARCHAR(255) PRIMARY KEY,
                            data JSONB
                        );
                    """)
                    _cur.execute("""
                        CREATE TABLE IF NOT EXISTS vectis_uploads (
                            filename VARCHAR(255) PRIMARY KEY,
                            data BYTEA,
                            mime_type VARCHAR(255)
                        );
                    """)
                    _conn.commit()
                print("[DB] Connected to PostgreSQL successfully. Tables checked/created.", flush=True)
            finally:
                _DB_POOL.putconn(_conn)
        except Exception as _e:
            print(f"[DB] [ERROR] Failed to initialize PostgreSQL connection: {_e}", flush=True)
            import traceback
            traceback.print_exc()
            _DB_POOL = None

def get_valid_connection():
    """Get a valid database connection from the pool, testing it and discarding if dead."""
    if not _DB_POOL:
        raise RuntimeError("PostgreSQL database pool is not initialized.")
    
    for attempt in range(10):
        conn = _DB_POOL.getconn()
        try:
            # Check if connection is closed
            if conn.closed:
                raise psycopg2.InterfaceError("Connection is closed")
            
            # Lightweight check
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
            return conn
        except (psycopg2.OperationalError, psycopg2.InterfaceError, Exception) as e:
            print(f"[DB] Discarding dead connection from pool (attempt {attempt + 1}/10): {e}", flush=True)
            try:
                _DB_POOL.putconn(conn, close=True)
            except Exception:
                pass
    
    # Last resort: the pool only handed us dead connections. Take one more and
    # only return it if it's actually open — otherwise fail loudly (503) instead
    # of handing the caller a dead handle that produces a confusing 500.
    conn = _DB_POOL.getconn()
    if getattr(conn, 'closed', 0):
        try:
            _DB_POOL.putconn(conn, close=True)
        except Exception:
            pass
        raise psycopg2.OperationalError("No live database connection available from pool")
    return conn


# --- File object storage (Supabase Storage) -------------------------------
#   Generated/uploaded PDFs are big binary blobs. Storing them in Postgres
#   bloats (and runs up the cost of) the database, so when SUPABASE_* env vars
#   are present we keep the files in a Supabase Storage bucket and store only a
#   reference in the app. Without the env vars the app falls back to the legacy
#   Postgres-BYTEA / local-disk behaviour, so local dev is unchanged.
_SUPABASE_URL    = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
_SUPABASE_KEY    = os.environ.get('SUPABASE_SERVICE_KEY') or ''
_SUPABASE_BUCKET = os.environ.get('SUPABASE_BUCKET') or ''
_STORAGE_ENABLED = bool(_SUPABASE_URL and _SUPABASE_KEY and _SUPABASE_BUCKET)


def _storage_object_url(filename):
    return f"{_SUPABASE_URL}/storage/v1/object/{_SUPABASE_BUCKET}/{urllib.parse.quote(filename)}"


def _storage_headers(extra=None):
    # Supabase's API gateway requires BOTH apikey and Authorization headers.
    h = {'apikey': _SUPABASE_KEY, 'Authorization': f'Bearer {_SUPABASE_KEY}'}
    if extra:
        h.update(extra)
    return h


def _storage_put(filename, file_bytes, mime_type):
    """Upload bytes to the Storage bucket (upsert). Returns True on success."""
    req = urllib.request.Request(
        _storage_object_url(filename), data=file_bytes, method='POST',
        headers=_storage_headers({
            'Content-Type': mime_type or 'application/octet-stream',
            'x-upsert': 'true',
            'Cache-Control': 'max-age=3600',
        }))
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:300]
        print(f"[Storage] PUT '{filename}' failed: HTTP {e.code} {body}", flush=True)
        raise


def _storage_get(filename):
    """Download from the bucket. Returns (bytes, mime) or None if absent."""
    req = urllib.request.Request(
        _storage_object_url(filename), method='GET', headers=_storage_headers())
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return (resp.read(), resp.headers.get('Content-Type', 'application/octet-stream'))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def _storage_exists(filename):
    """Best-effort existence check (HEAD). False on any error."""
    req = urllib.request.Request(
        _storage_object_url(filename), method='HEAD', headers=_storage_headers())
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status == 200
    except Exception:
        return False


def _storage_delete(filename):
    """Delete an object from the bucket. Returns True if the call succeeded."""
    req = urllib.request.Request(
        _storage_object_url(filename), method='DELETE', headers=_storage_headers())
    try:
        with urllib.request.urlopen(req, timeout=20):
            return True
    except Exception as e:
        print(f"[Storage] delete failed for {filename}: {e}", flush=True)
        return False


# Keys returned by GET /api/db, shared by the response builder and the ETag
# helper so they can never drift out of sync.
_DB_KEYS = [
    'po_documents',
    'qu_documents',
    'inv_documents',
    'prof_documents',
    'tm_documents',
    'saved_vendors',
    'saved_suppliers',
    'saved_correspondent_banks',
    'saved_beneficiary_banks',
    'saved_ultimate_beneficiary',
    'saved_domestic_banks',
    'app_settings',
    'po_column_visibility',
    'qu_column_visibility',
    'inv_column_visibility',
    'document_counters',
    'receipt_documents',
    'sales_return_documents',
    'receipt_banks',
    'uom_list',
    'activity_log',
    'auth_users',
    'auth_pending_users',
]

# Every key a client may write via /api/db/save. Same set as _DB_KEYS plus the
# admin password hash (never returned in GET, but writable). One source of truth
# so the read list and the save whitelist can't drift apart.
_SAVEABLE_KEYS = _DB_KEYS + ['auth_password_hash']

# Document collections that use atomic item-level deltas (/api/db/item) instead
# of whole-array replace, so concurrent edits to DIFFERENT documents can't
# clobber each other. Reference lists (vendors/banks/etc.) stay whole-array —
# a lost reference row is re-addable and some carry multi-row "default" toggles.
_ITEM_KEYS = {
    'po_documents', 'qu_documents', 'inv_documents', 'prof_documents',
    'tm_documents', 'receipt_documents', 'sales_return_documents',
}

def _db_etag(role):
    """A cheap fingerprint of the whole DB for conditional GETs.

    Built from each file's modification time + size (a stat, not a full read),
    so it changes the instant any document is written. In DB mode, it uses the
    in-memory global version counter. The caller's role is mixed in.
    """
    if _DB_POOL:
        digest = hashlib.sha256(f"{_DB_VERSION}|role:{role}".encode('utf-8')).hexdigest()
        return f'"{digest[:32]}"'

    parts = []
    for key in _DB_KEYS:
        p = os.path.join(DB_DIR, f'{key}.json')
        try:
            st = os.stat(p)
            parts.append(f'{key}:{st.st_mtime_ns}:{st.st_size}')
        except OSError:
            parts.append(f'{key}:-')
    parts.append(f'role:{role}')
    digest = hashlib.sha256('|'.join(parts).encode('utf-8')).hexdigest()
    return f'"{digest[:32]}"'

def _load_settings():
    """Load app_settings.json and return the dict."""
    path = os.path.join(DB_DIR, 'app_settings.json')
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def _send_json(handler, code, obj, extra_headers=None):
    """Utility: send a JSON response, optionally with extra headers (e.g. Set-Cookie).

    Compresses the body with gzip when the client advertises support and the
    payload is large enough to be worth it. JSON (and especially the activity
    log) shrinks ~70-85%, which is the main recurring transfer in the app.
    """
    body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    headers = list(extra_headers or [])

    accept = handler.headers.get('Accept-Encoding', '')
    if 'gzip' in accept.lower() and len(body) > 512:
        body = gzip.compress(body, 5)
        headers.append(('Content-Encoding', 'gzip'))
        headers.append(('Vary', 'Accept-Encoding'))

    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    for hk, hv in headers:
        handler.send_header(hk, hv)
    handler.end_headers()
    handler.wfile.write(body)


def _send_error(handler, code, exc, context=''):
    """Log the full exception server-side, return a GENERIC message to the client.

    Raw exception text (DB errors, file paths, SMTP failures, stack traces) must
    never reach the browser — it leaks internals to an attacker. The operator gets
    the real detail in the server log; the user gets a safe, code-appropriate line.
    """
    import traceback
    try:
        ip = handler.client_address[0] if getattr(handler, 'client_address', None) else '?'
    except Exception:
        ip = '?'
    print(f"[ERROR] {context or handler.path} from {ip}: {exc}", flush=True)
    traceback.print_exc()
    generic = {
        400: 'Invalid request.',
        403: 'Not allowed.',
        404: 'Not found.',
        413: 'Request too large.',
        500: 'Something went wrong. Please try again.',
        503: 'Service temporarily unavailable.',
    }.get(code, 'Request could not be completed.')
    _send_json(handler, code, {'error': generic})


# ──────────────────────────────────────────────────────
#  Authentication & Sessions (server-enforced)
# ──────────────────────────────────────────────────────
#  The login screen alone protects nothing — every data endpoint below
#  requires a valid session cookie issued by /api/auth/login. Only the
#  admin and users present in auth_users.json (i.e. approved by the admin)
#  can obtain a session.

# Admin signs in with this email (no separate username). Compared case-insensitively
# everywhere via _is_admin_id(). Override with the VECTIS_ADMIN_EMAIL env var.
ADMIN_USERNAME   = (os.environ.get('VECTIS_ADMIN_EMAIL') or 'admin@example.com').strip().lower()

def _is_admin_id(identifier):
    """True if the given login identifier is the admin's email (case-insensitive)."""
    return bool(identifier) and identifier.strip().lower() == ADMIN_USERNAME
SESSION_COOKIE   = 'vectis_session'
SESSION_TTL      = 12 * 3600          # absolute session lifetime: 12 hours
SESSION_IDLE_TTL = 30 * 60            # sliding idle timeout: 30 minutes of inactivity
SESSIONS         = {}                 # token -> {'user','role','fullName','expires','last_seen'}
SESSION_STORE_KEY = '_sessions'       # persisted store so logins survive a restart/redeploy
_TLS_ENABLED     = False              # set True at startup when serving HTTPS directly

def _persist_sessions():
    """Snapshot live sessions to the DB so a server restart doesn't log everyone
    out. Only the durable fields are stored; last_seen is intentionally omitted
    (it's reset to 'now' on load so a restart never idles-out an active user)."""
    try:
        snapshot = {t: {'user': s.get('user'), 'role': s.get('role'),
                        'fullName': s.get('fullName', ''), 'expires': s.get('expires', 0)}
                    for t, s in SESSIONS.items()}
        _write_db(SESSION_STORE_KEY, snapshot)
    except Exception as _e:
        print(f"[AUTH] Failed to persist sessions: {_e}", flush=True)

def _load_sessions():
    """Rehydrate sessions saved before the last restart. Absolute expiry is still
    honoured; last_seen starts fresh so the 30-min idle window restarts clean."""
    try:
        stored = _read_db(SESSION_STORE_KEY, {}) or {}
        now = time.time()
        for t, s in stored.items():
            if isinstance(s, dict) and s.get('expires', 0) > now:
                SESSIONS[t] = dict(s, last_seen=now)
        print(f"[AUTH] Restored {len(SESSIONS)} session(s) from store.", flush=True)
    except Exception as _e:
        print(f"[AUTH] Failed to load sessions: {_e}", flush=True)

def _int_env(name, default):
    """Read a positive-int tunable from the environment, falling back on default."""
    try:
        v = int(os.environ.get(name, ''))
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default

# Brute-force throttling. Keyed per IP+account (see _client_key). All tunables are
# env-configurable so limits can be tightened/loosened without a code change.
_FAILED          = {}                 # key -> [timestamps of recent failures]
_LOCK_THRESHOLD  = _int_env('VECTIS_LOCK_THRESHOLD', 6)    # free attempts before backoff
_LOCK_WINDOW     = _int_env('VECTIS_LOCK_WINDOW', 900)     # failure-memory window (s)
_LOCK_BASE_DELAY = _int_env('VECTIS_LOCK_BASE_DELAY', 2)   # first backoff step (s)
_LOCK_MAX_DELAY  = _int_env('VECTIS_LOCK_MAX_DELAY', 900)  # backoff cap (s)

# General per-IP request throttling (beyond login). bucket-key -> [timestamps].
_RATE            = {}
_POST_RATE_LIMIT  = _int_env('VECTIS_POST_RATE_LIMIT', 600)   # max POSTs / window / IP
_POST_RATE_WINDOW = _int_env('VECTIS_POST_RATE_WINDOW', 60)   # window (s)
def _rate_limited(handler, bucket, limit, window):
    """True (and records the hit) when this IP has exceeded `limit` requests to
    `bucket` within `window` seconds. Fails open on any error."""
    try:
        ip = handler.client_address[0] if handler.client_address else '?'
        key = f'{bucket}|{ip}'
        now = time.time()
        arr = [t for t in _RATE.get(key, []) if now - t < window]
        arr.append(now)
        _RATE[key] = arr
        # Opportunistic cleanup so the dict can't grow without bound.
        if len(_RATE) > 5000:
            for k in [k for k, v in _RATE.items() if not v or now - v[-1] > 3600]:
                _RATE.pop(k, None)
        return len(arr) > limit
    except Exception:
        return False

def _csrf_ok(handler):
    """Defense-in-depth against CSRF (atop the SameSite=Strict cookie): reject a
    state-changing request whose Origin/Referer is a *different* host than the one
    it was sent to. Requests with no Origin/Referer (non-browser clients, some
    same-origin POSTs) are allowed — the session cookie still gates them."""
    try:
        host = (handler.headers.get('Host') or '').split(':')[0].lower()
        for header in ('Origin', 'Referer'):
            val = handler.headers.get(header)
            if not val:
                continue
            h = urllib.parse.urlparse(val).hostname
            if h is None:
                continue
            return h.lower() == host
        return True  # neither header present
    except Exception:
        return True

def _sha256_hex(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

# ── Password hashing ──────────────────────────────────────────────
# Passwords are stored with a slow, salted KDF (PBKDF2-HMAC-SHA256) so a leak of
# the user DB cannot be reversed with rainbow tables or fast brute force.
# Format:  pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
# Legacy records are plain 64-char SHA-256 hex; _verify_password accepts both and
# callers transparently upgrade them to the new format on the next successful
# login / password change.
_PBKDF2_ITERATIONS = 240000

def _hash_password(password):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, _PBKDF2_ITERATIONS)
    return f'pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}'

def _verify_password(password, stored):
    """Constant-time verify against either a PBKDF2 record or a legacy SHA-256 hex."""
    if not stored or password is None:
        return False
    stored = str(stored)
    if stored.startswith('pbkdf2_sha256$'):
        try:
            _, iter_s, salt_hex, hash_hex = stored.split('$', 3)
            dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'),
                                     bytes.fromhex(salt_hex), int(iter_s))
            return hmac.compare_digest(dk.hex(), hash_hex)
        except Exception:
            return False
    # Legacy unsalted SHA-256 hex
    return hmac.compare_digest(_sha256_hex(password), stored)

def _is_legacy_hash(stored):
    """True if the stored hash is the old unsalted SHA-256 format and should be upgraded."""
    return isinstance(stored, str) and not stored.startswith('pbkdf2_sha256$')

def _read_db(name, default, conn=None):
    """Read a db/<name>.json file, returning default on any problem."""
    if _DB_POOL:
        _conn = conn
        _must_release = False
        try:
            if _conn is None:
                _conn = get_valid_connection()
                _must_release = True
            with _conn.cursor() as _cur:
                _cur.execute("SELECT data FROM vectis_db WHERE key = %s;", (name,))
                _row = _cur.fetchone()
                if _row:
                    val = _row[0]
                    if isinstance(val, str):
                        try:
                            return json.loads(val)
                        except Exception:
                            return val
                    return val
                return default
        except Exception as _e:
            print(f"[DB] [ERROR] Reading key '{name}' from PostgreSQL: {_e}", flush=True)
            if _conn and _must_release:
                try:
                    _conn.rollback()
                except Exception:
                    pass
            return default
        finally:
            if _conn and _must_release:
                try:
                    _DB_POOL.putconn(_conn)
                except Exception:
                    pass
    else:
        path = os.path.join(DB_DIR, f'{name}.json')
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return default
        return default

def _write_db(name, data):
    global _DB_VERSION
    _DB_VERSION = int(time.time() * 1000)
    
    if _DB_POOL:
        _conn = None
        try:
            _conn = get_valid_connection()
            with _conn.cursor() as _cur:
                _cur.execute("""
                    INSERT INTO vectis_db (key, data)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (key)
                    DO UPDATE SET data = EXCLUDED.data;
                """, (name, json.dumps(data, ensure_ascii=False)))
                _conn.commit()
        except Exception as _e:
            print(f"[DB] [ERROR] Writing key '{name}' to PostgreSQL: {_e}", flush=True)
            if _conn:
                try:
                    _conn.rollback()
                except Exception:
                    pass
            raise _e
        finally:
            if _conn:
                try:
                    _DB_POOL.putconn(_conn)
                except Exception:
                    pass
    else:
        # Atomic write: serialise to a temp file in the same dir, flush to disk,
        # then os.replace() (atomic on POSIX & Windows). A crash or concurrent
        # write can never leave a truncated/corrupt half-written JSON file.
        os.makedirs(DB_DIR, exist_ok=True)
        final = os.path.join(DB_DIR, f'{name}.json')
        tmp = f'{final}.{os.getpid()}.tmp'
        try:
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, final)
        finally:
            if os.path.exists(tmp):
                try: os.remove(tmp)
                except OSError: pass


# ── Atomic read-modify-write for concurrent-safe deltas ──────────────
# Whole-array PUTs (/api/db/save) suffer lost updates: two clients each holding a
# stale full collection overwrite each other. These deltas apply one change to
# the server's CURRENT state under a lock, so concurrent edits to different
# documents (and concurrent serial allocations) can't collide.

_WRITE_LOCK = threading.Lock()  # ponytail: single global lock in file mode; DB mode locks per-row via SELECT … FOR UPDATE

def _new_cnt_id():
    return 'CNT_' + str(int(time.time() * 1000)) + '_' + secrets.token_hex(3)

def _append_only_log(existing, incoming):
    """Pure: merge a non-admin's activity-log upload. Existing entries always
    win (no deleting or rewriting); only entries with a new id are added."""
    if not isinstance(existing, list):
        return incoming
    existing_ids = {e.get('id') for e in existing if isinstance(e, dict)}
    added = [e for e in incoming if isinstance(e, dict) and e.get('id') not in existing_ids]
    return added + existing  # newest-first, as the client keeps it

def _apply_item_op(current, op, item=None, items=None, item_id=None):
    """Pure: apply an upsert/upsertMany/delete (by 'id') to a list. Returns the new list."""
    lst = current if isinstance(current, list) else []
    if op == 'delete':
        return [d for d in lst if not (isinstance(d, dict) and d.get('id') == item_id)]
    src = items if op == 'upsertMany' else [item]
    for it in (src or []):
        if not isinstance(it, dict) or not it.get('id'):
            continue
        idx = next((i for i, d in enumerate(lst)
                    if isinstance(d, dict) and d.get('id') == it['id']), None)
        if idx is None:
            lst.insert(0, it)   # newest-first, matching the client
        else:
            lst[idx] = it
    return lst

def _apply_serial_op(current, op, doc_type, month, fy, value=0):
    """Pure: allocate the next serial (op='increment') or raise a floor (op='bump').
    Returns (new_counters_list, allocated_number). Never rewinds a counter."""
    counters = current if isinstance(current, list) else []
    rec = next((c for c in counters if isinstance(c, dict)
                and c.get('doc_type') == doc_type and c.get('month') == month
                and c.get('fy') == fy), None)
    if op == 'bump':
        try:
            value = int(value)
        except (TypeError, ValueError):
            value = 0
        if value <= 0:
            return counters, (rec.get('last_number', 0) if rec else 0)
        if rec:
            if value > rec.get('last_number', 0):
                rec['last_number'] = value
        else:
            rec = {'id': _new_cnt_id(), 'doc_type': doc_type, 'month': month,
                   'fy': fy, 'last_number': value}
            counters.append(rec)
        return counters, rec['last_number']
    # increment
    if rec:
        rec['last_number'] = rec.get('last_number', 0) + 1
    else:
        rec = {'id': _new_cnt_id(), 'doc_type': doc_type, 'month': month,
               'fy': fy, 'last_number': 1}
        counters.append(rec)
    return counters, rec['last_number']

def _mutate_db(key, mutator):
    """Atomically read-modify-write one DB key. `mutator(current)` returns
    (new_value, result); result is returned to the caller. DB mode serialises on
    the row via SELECT … FOR UPDATE inside one transaction; file mode uses a
    global lock."""
    global _DB_VERSION
    if _DB_POOL:
        conn = None
        try:
            conn = get_valid_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM vectis_db WHERE key = %s FOR UPDATE;", (key,))
                row = cur.fetchone()
                current = row[0] if row else None
                if isinstance(current, str):
                    try:
                        current = json.loads(current)
                    except Exception:
                        pass
                new_val, result = mutator(current)
                cur.execute("""
                    INSERT INTO vectis_db (key, data)
                    VALUES (%s, %s::jsonb)
                    ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data;
                """, (key, json.dumps(new_val, ensure_ascii=False)))
            conn.commit()
            _DB_VERSION = int(time.time() * 1000)
            return result
        except Exception:
            if conn:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise
        finally:
            if conn:
                try:
                    _DB_POOL.putconn(conn)
                except Exception:
                    pass
    else:
        with _WRITE_LOCK:
            current = _read_db(key, None)
            new_val, result = mutator(current)
            _write_db(key, new_val)
            return result


def _admin_hash():
    """Stored admin password hash, or the SHA-256 of the default 'admin123'."""
    h = _read_db('auth_password_hash', None)
    if isinstance(h, str) and h:
        return h
    return _sha256_hex('admin123')

def _validate_credentials(username, password):
    """Return a session info dict on success, 'pending' if awaiting approval, else None."""
    if not username or password is None:
        return None

    if _is_admin_id(username):
        stored = _admin_hash()
        if _verify_password(password, stored):
            # Upgrade a legacy/default hash to salted PBKDF2 on successful login.
            if _is_legacy_hash(stored):
                _write_db('auth_password_hash', _hash_password(password))
            return {'user': ADMIN_USERNAME, 'role': 'admin', 'fullName': 'Administrator'}
        return None

    users = _read_db('auth_users', [])
    if isinstance(users, list):
        for i, u in enumerate(users):
            if u.get('username') == username and u.get('passwordHash'):
                if _verify_password(password, u['passwordHash']):
                    if _is_legacy_hash(u['passwordHash']):
                        users[i]['passwordHash'] = _hash_password(password)
                        _write_db('auth_users', users)
                    return {'user': username, 'role': 'user', 'fullName': u.get('fullName', '')}

    pending = _read_db('auth_pending_users', [])
    if isinstance(pending, list) and any(u.get('username') == username for u in pending):
        return 'pending'
    return None

def _new_session(info):
    token = secrets.token_urlsafe(32)
    now = time.time()
    SESSIONS[token] = dict(info, expires=now + SESSION_TTL, last_seen=now)
    # Opportunistic cleanup of absolutely-expired tokens (idle no longer expires
    # server-side — see _get_session).
    for t in [t for t, s in SESSIONS.items() if s['expires'] < now]:
        SESSIONS.pop(t, None)
    _persist_sessions()
    return token

def _get_session(handler):
    """Return the live session dict for this request, or None."""
    raw = handler.headers.get('Cookie', '')
    if not raw:
        return None
    token = None
    # 1. Try robust regex extraction first (resilient against malformed/third-party cookies)
    pattern = r'(?:^|;\s*)' + re.escape(SESSION_COOKIE) + r'=([^;]+)'
    m = re.search(pattern, raw)
    if m:
        token = urllib.parse.unquote(m.group(1).strip('"\''))
    else:
        # 2. Fallback to SimpleCookie parsing
        try:
            jar = SimpleCookie()
            jar.load(raw)
            morsel = jar.get(SESSION_COOKIE)
            if morsel:
                token = morsel.value
        except Exception:
            token = None

    if not token:
        return None

    now = time.time()
    sess = SESSIONS.get(token)
    if not sess:
        # Not in this process's memory — the server may have restarted (or this is
        # a different instance). Fall back to the persisted store so a valid cookie
        # keeps working WITHOUT forcing a re-login ("Session expired"). Rehydrate on hit.
        stored = _read_db(SESSION_STORE_KEY, {}) or {}
        s = stored.get(token)
        if isinstance(s, dict) and s.get('expires', 0) > now:
            sess = dict(s, last_seen=now)
            SESSIONS[token] = sess
        else:
            return None
    # Absolute lifetime only. The server-side idle timeout is intentionally NOT
    # enforced here: a user actively filling a form makes no server requests, so an
    # idle cutoff would log them out mid-work. Inactivity is handled client-side
    # (configurable auto-logout in Settings), which tears the session down properly.
    if sess['expires'] < now:
        SESSIONS.pop(token, None)
        return None
    sess['last_seen'] = now  # sliding window — activity keeps the session alive
    return dict(sess, token=token)

def _cookie_header(handler, token, clear=False):
    # Mark the cookie Secure when the connection is HTTPS — either served
    # directly with TLS, or terminated by a proxy that forwards X-Forwarded-Proto.
    is_https = _TLS_ENABLED or handler.headers.get('X-Forwarded-Proto', '').lower() == 'https'
    secure = '; Secure' if is_https else ''
    if clear:
        return (f'{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}')
    return (f'{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; '
            f'Max-Age={SESSION_TTL}{secure}')

def _client_key(handler, username=''):
    ip = handler.client_address[0] if handler.client_address else '?'
    return f'{ip}|{username.lower()}'

def _is_locked(key):
    """Exponential backoff instead of a flat lockout: the first _LOCK_THRESHOLD
    failures are free, then each further failure doubles the wait required since
    the last attempt (base → 2× → 4× …), capped at _LOCK_MAX_DELAY. A legit user
    who fat-fingers waits seconds; a brute-forcer faces exploding delays."""
    now = time.time()
    arr = [t for t in _FAILED.get(key, []) if now - t < _LOCK_WINDOW]
    _FAILED[key] = arr
    n = len(arr)
    if n < _LOCK_THRESHOLD:
        return False
    delay = min(_LOCK_BASE_DELAY * (2 ** (n - _LOCK_THRESHOLD)), _LOCK_MAX_DELAY)
    return (now - arr[-1]) < delay

def _record_failure(key):
    _FAILED.setdefault(key, []).append(time.time())

def _generate_otp():
    return str(secrets.randbelow(900000) + 100000)

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

def _valid_email(email):
    """Basic structural check that also rejects CR/LF (SMTP header injection)."""
    return bool(email) and '\n' not in email and '\r' not in email \
        and len(email) <= 254 and _EMAIL_RE.match(email) is not None


def _send_otp_email(to_email, otp_code, full_name):
    settings = _load_settings()
    smtp_host = settings.get('smtpHost', '').strip()
    smtp_port = int(settings.get('smtpPort') or 587)
    smtp_user = settings.get('smtpUser', '').strip()
    smtp_password = settings.get('smtpPassword', '').strip()
    from_name = (settings.get('smtpFromName') or 'Vectis').strip()

    if not smtp_host or not smtp_user or not smtp_password:
        raise RuntimeError('smtp_not_configured')

    name_display = full_name or 'there'
    html = f"""
<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f9f9f9;border-radius:12px;">
  <h2 style="color:#004d2c;margin-bottom:8px;">Email Verification</h2>
  <p style="color:#444;margin-bottom:24px;">Hi {name_display}, use this code to verify your email for Vectis registration:</p>
  <div style="background:#fff;border:2px dashed #004d2c;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
    <span style="font-size:36px;font-weight:bold;letter-spacing:10px;color:#004d2c;">{otp_code}</span>
  </div>
  <p style="color:#666;font-size:13px;">This code expires in <b>10 minutes</b>. Do not share it with anyone.</p>
  <p style="color:#999;font-size:11px;margin-top:24px;">Vectis</p>
</div>"""
    text = f"Your Vectis verification code is: {otp_code}\nExpires in 10 minutes."

    msg = MIMEMultipart('alternative')
    msg['Subject'] = 'Vectis — Email Verification Code'
    msg['From'] = f'{from_name} <{smtp_user}>'
    msg['To'] = to_email
    msg.attach(MIMEText(text, 'plain'))
    msg.attach(MIMEText(html, 'html'))

    with smtplib.SMTP(smtp_host, smtp_port) as s:
        s.ehlo()
        s.starttls()
        s.ehlo()
        s.login(smtp_user, smtp_password)
        s.sendmail(smtp_user, [to_email], msg.as_string())


# ──────────────────────────────────────────────────────
#  HTTP Handler
# ──────────────────────────────────────────────────────

# Static-file access control.
#
# SECURITY: never decide what to serve by string-matching the raw request
# path — it is still URL-encoded, so "/%64b/secret.json" sneaks past a
# substring test for "db/" yet is decoded to "/db/secret.json" before the
# file is read. Instead we resolve the request to a real filesystem path
# (which decodes %xx and collapses traversal) and check THAT.
_APP_ROOT          = os.path.dirname(os.path.abspath(__file__))

# Sensitive OS directories that generated PDFs/backups must never be written into,
# regardless of what an authenticated user puts in their "save path". This blocks
# clobbering system binaries/config even by a trusted-but-careless user.
def _build_forbidden_write_dirs():
    raw = []
    if os.name == 'nt':
        for env in ('SystemRoot', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData', 'windir'):
            v = os.environ.get(env)
            if v:
                raw.append(v)
        raw += [r'C:\Windows', r'C:\Program Files', r'C:\Program Files (x86)']
    else:
        raw += ['/etc', '/bin', '/sbin', '/usr', '/lib', '/lib64', '/boot',
                '/root', '/sys', '/proc', '/dev', '/var/lib', '/var/run', '/run']
    out = []
    for p in raw:
        try:
            rp = os.path.realpath(p)
            if rp not in out:
                out.append(rp)
        except Exception:
            pass
    return out

_FORBIDDEN_WRITE_DIRS = _build_forbidden_write_dirs()

# Optional allow-list: when VECTIS_SAVE_ROOTS is set (os.pathsep-separated dirs),
# PDF/backup writes are permitted ONLY inside those roots (plus the app's uploads/).
# Unset → no extra restriction beyond the denylist (back-compatible).
_SAVE_ROOTS = []
for _r in os.environ.get('VECTIS_SAVE_ROOTS', '').split(os.pathsep):
    if _r.strip():
        try:
            _SAVE_ROOTS.append(os.path.realpath(_r.strip()))
        except Exception:
            pass

def _within(target, base):
    """True if absolute path `target` is `base` or inside it."""
    try:
        base_rp = os.path.realpath(base)
        return os.path.commonpath([base_rp, target]) == base_rp
    except Exception:
        return False

_FORBIDDEN_DIRS    = {'db', 'scratch', 'uploads', '__pycache__', 'certs', 'deploy',
                      '.git', '.vscode', '.claude', 'node_modules'}
_FORBIDDEN_EXTS    = {'.py', '.pyc', '.pyo', '.pyw', '.log', '.bat', '.sh', '.ps1',
                      '.md', '.json', '.env', '.ini', '.cfg', '.lock',
                      '.yaml', '.yml', '.txt',
                      '.sqlite', '.db', '.bak',
                      # TLS material & keys must never be served as static files.
                      '.pem', '.key', '.crt', '.cer', '.pfx', '.p12', '.csr'}

def _is_static_forbidden(handler):
    """True if this request must NOT be served as a static file.

    Resolves the request to an absolute filesystem path and rejects anything
    outside the app root, inside a sensitive directory, a dotfile, or a
    sensitive file type. This runs on the DECODED path so URL-encoding tricks
    cannot bypass it.
    """
    try:
        fs_path = os.path.realpath(handler.translate_path(handler.path))
    except Exception:
        return True
    # Must stay within the application root (blocks traversal / symlink escape).
    try:
        if os.path.commonpath([_APP_ROOT, fs_path]) != _APP_ROOT:
            return True
    except ValueError:
        # Different drive on Windows → outside the root.
        return True
    rel = os.path.relpath(fs_path, _APP_ROOT).replace('\\', '/')
    for part in rel.split('/'):
        if part in ('', '.'):
            continue
        if part.startswith('.'):          # dotfiles (.env, .DS_Store, .git…)
            return True
        if part.lower() in _FORBIDDEN_DIRS:
            return True
    if os.path.splitext(fs_path)[1].lower() in _FORBIDDEN_EXTS:
        return True
    return False


def _is_write_forbidden(target_dir):
    """True if writing into target_dir is not allowed.

    Blocks three things:
      1. The application's own tree (js/, css/, root, …) — overwriting served
         code would be stored XSS / RCE. The uploads/ subtree is the one
         in-root exception.
      2. Sensitive OS directories (Windows, /etc, /usr, …) — guards against a
         careless/hostile save path clobbering the system.
      3. Anything outside VECTIS_SAVE_ROOTS, when that allow-list is configured.
    Fails closed on any unexpected error.
    """
    try:
        target = os.path.realpath(target_dir)
    except Exception:
        return True

    uploads = os.path.join(_APP_ROOT, 'uploads')
    in_uploads = _within(target, uploads)

    # 1. Application tree (except uploads/).
    if not in_uploads and _within(target, _APP_ROOT):
        return True

    # 2. Sensitive system directories — never, even via the uploads exception.
    for d in _FORBIDDEN_WRITE_DIRS:
        if _within(target, d):
            return True

    # 3. Optional allow-list: must be inside a configured root (or uploads/).
    if _SAVE_ROOTS and not in_uploads and not any(_within(target, r) for r in _SAVE_ROOTS):
        return True

    return False


class CustomHandler(SimpleHTTPRequestHandler):
    # Cap request bodies to keep a single client from exhausting memory.
    MAX_BODY = 60 * 1024 * 1024  # 60 MB (large enough for scanned PDFs)

    # Uploads are documents/images only. Reject anything that could execute in the
    # browser same-origin (.html/.svg/.js/.xml) — an allowlist, not a denylist, so
    # unknown/dangerous types are refused by default. Configurable via env.
    ALLOWED_UPLOAD_EXTS = set(
        (os.environ.get('VECTIS_UPLOAD_EXTS') or
         '.pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt')
        .lower().replace(' ', '').split(',')
    )

    def do_HEAD(self):
        if _is_static_forbidden(self):
            self.send_response(404)
            self.end_headers()
            return
        super().do_HEAD()

    def do_GET(self):
        req_path = self.path.split('?', 1)[0]
        # ── Health check endpoint (public: used by UptimeRobot / monitoring services) ──
        if req_path in ('/health', '/api/health'):
            _send_json(self, 200, {
                'success': True,
                'message': 'Server is healthy',
                'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
            })
            return

        # ── Session status (public: tells the frontend whether a cookie is valid) ──
        if self.path == '/api/auth/session':
            sess = _get_session(self)
            if sess:
                _send_json(self, 200, {
                    'authenticated': True,
                    'user': sess['user'],
                    'role': sess['role'],
                    'fullName': sess.get('fullName', '')
                })
            else:
                _send_json(self, 200, {'authenticated': False})
            return

        if self.path == '/api/db':
            sess = _get_session(self)
            if not sess:
                _send_json(self, 401, {'error': 'Authentication required'})
                return

            # Conditional request: if the client already holds the current DB,
            # answer 304 and skip reading/serializing every file.
            etag = _db_etag(sess.get('role'))
            if self.headers.get('If-None-Match') == etag:
                self.send_response(304)
                self.send_header('ETag', etag)
                self.end_headers()
                return

            db_data = {key: None for key in _DB_KEYS}
            if _DB_POOL:
                _conn = None
                try:
                    _conn = get_valid_connection()
                    with _conn.cursor() as _cur:
                        _cur.execute("SELECT key, data FROM vectis_db WHERE key = ANY(%s);", (_DB_KEYS,))
                        for row in _cur.fetchall():
                            k, val = row[0], row[1]
                            if isinstance(val, str):
                                try:
                                    val = json.loads(val)
                                except Exception:
                                    pass
                            db_data[k] = val
                except Exception as e:
                    print(f"[DB] [ERROR] Failed to batch read DB in /api/db: {e}", flush=True)
                finally:
                    if _conn:
                        try:
                            _DB_POOL.putconn(_conn)
                        except Exception:
                            pass
            else:
                for key in _DB_KEYS:
                    db_data[key] = _read_db(key, None)

            for key in _DB_KEYS:
                data = db_data[key]
                if data is not None:
                    if key == 'app_settings' and isinstance(data, dict):
                        data = data.copy()
                        data.pop('geminiApiKey', None)
                        data.pop('smtpPassword', None)
                        # Non-admins only ever see their own per-user save paths.
                        if sess.get('role') != 'admin' and isinstance(data.get('userPaths'), dict):
                            own = data['userPaths'].get(sess.get('user'))
                            data['userPaths'] = {sess.get('user'): own} if isinstance(own, dict) else {}
                        db_data[key] = data

            # Never expose password hashes to non-admin sessions.
            if sess.get('role') != 'admin':
                for ukey in ('auth_users', 'auth_pending_users'):
                    if isinstance(db_data.get(ukey), list):
                        db_data[ukey] = [
                            {k: v for k, v in u.items() if k != 'passwordHash'}
                            for u in db_data[ukey] if isinstance(u, dict)
                        ]

            _send_json(self, 200, db_data, extra_headers=[('ETag', etag)])


        elif self.path.startswith('/uploads/'):
            if not _get_session(self):
                _send_json(self, 401, {'error': 'Authentication required'})
                return
            settings = _load_settings()
            custom_upload_path = settings.get('uploadSavePath', '').strip()
            filename = os.path.basename(urllib.parse.unquote(self.path))

            # Serve from object storage first (where new files live).
            if _STORAGE_ENABLED:
                try:
                    _got = _storage_get(filename)
                except Exception as _e:
                    print(f"[Storage] read failed for '{filename}': {_e}", flush=True)
                    _got = None
                if _got:
                    _fb, _mime = _got
                    self.send_response(200)
                    self.send_header('Content-Type', _mime or 'application/octet-stream')
                    self.send_header('Content-Length', str(len(_fb)))
                    self.end_headers()
                    self.wfile.write(_fb)
                    return

            # Try serving from PostgreSQL database next (legacy / not-yet-migrated)
            if _DB_POOL:
                _conn = None
                _row = None
                try:
                    _conn = get_valid_connection()
                    with _conn.cursor() as _cur:
                        _cur.execute("SELECT data, mime_type FROM vectis_uploads WHERE filename = %s;", (filename,))
                        _row = _cur.fetchone()
                except Exception as _e:
                    print(f"[DB] [ERROR] Loading upload '{filename}' from PostgreSQL: {_e}", flush=True)
                    if _conn:
                        _conn.rollback()
                finally:
                    if _conn:
                        _DB_POOL.putconn(_conn)
                
                if _row:
                    file_bytes = bytes(_row[0])
                    mime = _row[1] or 'application/octet-stream'
                    self.send_response(200)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Length', str(len(file_bytes)))
                    self.end_headers()
                    self.wfile.write(file_bytes)
                    return

            # Filesystem fallback
            if custom_upload_path:
                uploads_dir = os.path.abspath(os.path.expanduser(os.path.expandvars(custom_upload_path)))
            else:
                uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')

            full_path = os.path.join(uploads_dir, filename)

            if os.path.exists(full_path) and os.path.isfile(full_path):
                ext = os.path.splitext(filename)[1].lower()
                mime = 'application/octet-stream'
                if ext == '.pdf': mime = 'application/pdf'
                elif ext in ['.png']: mime = 'image/png'
                elif ext in ['.jpg', '.jpeg']: mime = 'image/jpeg'
                elif ext in ['.doc', '.docx']: mime = 'application/msword'

                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', os.path.getsize(full_path))
                self.end_headers()
                with open(full_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"File not found")

        else:
            # Static file: serve only after the resolved path passes the
            # access-control check (blocks db/, source, dotfiles, traversal).
            if _is_static_forbidden(self):
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Not Found")
                return
            super().do_GET()

    def _read_body(self):
        """Read and JSON-decode the request body; returns dict or None."""
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            return None
        try:
            return json.loads(self.rfile.read(content_length).decode('utf-8'))
        except Exception:
            return None

    def _require_session(self, role=None):
        """Return the session if authenticated (and authorized), else send 401/403 and return None."""
        sess = _get_session(self)
        if not sess:
            _send_json(self, 401, {'error': 'Authentication required. Please sign in.'})
            return None
        if role and sess.get('role') != role:
            _send_json(self, 403, {'error': 'You do not have permission to perform this action.'})
            return None
        return sess

    def do_POST(self):
        # Reject oversized bodies up front so a single request can't exhaust memory.
        try:
            if int(self.headers.get('Content-Length', 0)) > self.MAX_BODY:
                _send_json(self, 413, {'error': 'Request body too large.'})
                return
        except (TypeError, ValueError):
            _send_json(self, 400, {'error': 'Invalid Content-Length.'})
            return

        path0 = self.path.split('?', 1)[0]

        # CSRF defense-in-depth (atop the SameSite=Strict cookie): refuse a
        # state-changing POST whose Origin/Referer is a different host.
        if not _csrf_ok(self):
            _send_json(self, 403, {'error': 'Cross-origin request blocked.'})
            return

        # Per-IP throttling. A generous overall cap (env-tunable) plus stricter caps
        # on the expensive / abuse-prone endpoints (OTP emails, uploads).
        if _rate_limited(self, 'post', _POST_RATE_LIMIT, _POST_RATE_WINDOW):
            _send_json(self, 429, {'error': 'Too many requests. Please slow down.'})
            return
        _endpoint_limits = {
            '/api/save-pdf': (120, 60),
            '/api/upload-file': (120, 60),
            '/api/save-backup': (30, 60),
            '/api/auth/send-verification': (5, 300),
            '/api/auth/register': (10, 600),
        }
        _lim = _endpoint_limits.get(path0)
        if _lim and _rate_limited(self, path0, _lim[0], _lim[1]):
            _send_json(self, 429, {'error': 'Too many requests for this action. Please wait a moment.'})
            return

        # ── Authentication endpoints (public) ──
        if self.path == '/api/auth/login':
            data = self._read_body() or {}
            username = (data.get('username') or '').strip()
            password = data.get('password') or ''
            key = _client_key(self, username)
            if _is_locked(key):
                _send_json(self, 429, {'error': 'Too many failed attempts. Please wait 15 minutes and try again.'})
                return
            result = _validate_credentials(username, password)
            if result == 'pending':
                _send_json(self, 403, {'error': 'pending', 'pending': True})
                return
            if not result:
                _record_failure(key)
                _send_json(self, 401, {'error': 'Invalid username or password.'})
                return
            _FAILED.pop(key, None)
            token = _new_session(result)
            _send_json(self, 200,
                       {'success': True, 'user': result['user'], 'role': result['role'],
                        'fullName': result.get('fullName', '')},
                       extra_headers=[('Set-Cookie', _cookie_header(self, token))])
            return

        if self.path == '/api/auth/logout':
            sess = _get_session(self)
            if sess:
                SESSIONS.pop(sess['token'], None)
                _persist_sessions()
            _send_json(self, 200, {'success': True},
                       extra_headers=[('Set-Cookie', _cookie_header(self, None, clear=True))])
            return

        if self.path == '/api/auth/change-password':
            sess = self._require_session()
            if not sess:
                return
            data = self._read_body() or {}
            old_pwd = data.get('oldPassword') or ''
            new_pwd = data.get('newPassword') or ''
            if not old_pwd or not new_pwd:
                _send_json(self, 400, {'error': 'Missing passwords.'})
                return
            if len(new_pwd) < 6:
                _send_json(self, 400, {'error': 'New password must be at least 6 characters.'})
                return
            new_hash = _hash_password(new_pwd)
            username = sess['user']
            role = sess['role']
            if role == 'admin':
                if not _verify_password(old_pwd, _admin_hash()):
                    _send_json(self, 401, {'error': 'Invalid current password.'})
                    return
                _write_db('auth_password_hash', new_hash)
                _send_json(self, 200, {'success': True})
            else:
                users = _read_db('auth_users', [])
                idx = next((i for i, u in enumerate(users) if u.get('username') == username), None)
                if idx is None:
                    _send_json(self, 404, {'error': 'User not found.'})
                    return
                if not users[idx].get('passwordHash') or not _verify_password(old_pwd, users[idx]['passwordHash']):
                    _send_json(self, 401, {'error': 'Invalid current password.'})
                    return
                users[idx]['passwordHash'] = new_hash
                _write_db('auth_users', users)
                _send_json(self, 200, {'success': True})
            return

        if self.path == '/api/auth/send-verification':
            key = _client_key(self, 'send-verification')
            if _is_locked(key):
                _send_json(self, 429, {'error': 'Too many attempts. Please wait and try again.'})
                return
            data = self._read_body() or {}
            username = (data.get('username') or '').strip()
            email    = (data.get('email') or '').strip()
            password = data.get('password') or ''
            full_name   = (data.get('fullName') or '').strip()
            department  = (data.get('department') or '').strip()
            if len(username) < 3 or len(password) < 6:
                _send_json(self, 400, {'error': 'Username must be 3+ characters and password 6+ characters.'})
                return
            if not _valid_email(email):
                _send_json(self, 400, {'error': 'A valid email address is required.'})
                return
            if _is_admin_id(username):
                _send_json(self, 409, {'error': 'username_taken'})
                return
            users   = _read_db('auth_users', [])
            pending = _read_db('auth_pending_users', [])
            if any(u.get('username') == username for u in users):
                _send_json(self, 409, {'error': 'username_taken'})
                return
            if any(u.get('username') == username for u in pending):
                _send_json(self, 409, {'error': 'already_pending'})
                return
            otp = _generate_otp()
            _OTP_STORE[email] = {
                'code': otp,
                'expires': time.time() + OTP_TTL,
                'regData': {
                    'username': username,
                    'passwordHash': _hash_password(password),
                    'fullName': full_name,
                    'email': email,
                    'department': department
                }
            }
            try:
                _send_otp_email(email, otp, full_name)
                _record_failure(key)
                _send_json(self, 200, {'success': True})
            except RuntimeError as exc:
                if str(exc) == 'smtp_not_configured':
                    _send_json(self, 503, {'error': 'smtp_not_configured',
                                           'message': 'Email service is not configured. Please ask the admin to set up SMTP in Settings.'})
                else:
                    _send_error(self, 500, exc, 'send OTP email')
            except Exception as exc:
                _send_error(self, 500, exc, f'send OTP email to {email}')
            return

        if self.path == '/api/auth/verify-otp':
            data  = self._read_body() or {}
            email = (data.get('email') or '').strip()
            otp   = (data.get('otp') or '').strip()
            if not email or not otp:
                _send_json(self, 400, {'error': 'Email and code are required.'})
                return
            entry = _OTP_STORE.get(email)
            if not entry:
                _send_json(self, 400, {'error': 'invalid_otp',
                                       'message': 'No pending verification found. Please register again.'})
                return
            if time.time() > entry['expires']:
                _OTP_STORE.pop(email, None)
                _send_json(self, 400, {'error': 'otp_expired',
                                       'message': 'Code has expired. Please register again.'})
                return
            if otp != entry['code']:
                _send_json(self, 400, {'error': 'invalid_otp',
                                       'message': 'Incorrect code. Please try again.'})
                return
            reg = entry['regData']
            _OTP_STORE.pop(email, None)
            # Re-check availability
            users   = _read_db('auth_users', [])
            pending = _read_db('auth_pending_users', [])
            if any(u.get('username') == reg['username'] for u in users + pending):
                _send_json(self, 409, {'error': 'username_taken'})
                return
            pending.append({
                'id': 'USR_' + str(int(time.time() * 1000)) + '_' + secrets.token_hex(3),
                'username': reg['username'],
                'passwordHash': reg['passwordHash'],
                'fullName': reg['fullName'],
                'email': reg['email'],
                'department': reg['department'],
                'requestedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
            })
            _write_db('auth_pending_users', pending)
            _send_json(self, 200, {'success': True})
            return

        if self.path == '/api/auth/register':
            key = _client_key(self, 'register')
            if _is_locked(key):
                _send_json(self, 429, {'error': 'Too many registration attempts. Please wait and try again.'})
                return
            data = self._read_body() or {}
            username = (data.get('username') or '').strip()
            password = data.get('password') or ''
            if len(username) < 3 or len(password) < 6:
                _send_json(self, 400, {'error': 'Username must be 3+ characters and password 6+ characters.'})
                return
            if _is_admin_id(username):
                _send_json(self, 409, {'error': 'username_taken'})
                return
            users = _read_db('auth_users', [])
            pending = _read_db('auth_pending_users', [])
            if any(u.get('username') == username for u in users):
                _send_json(self, 409, {'error': 'username_taken'})
                return
            if any(u.get('username') == username for u in pending):
                _send_json(self, 409, {'error': 'already_pending'})
                return
            _record_failure(key)  # count registrations toward the throttle window
            pending.append({
                'id': 'USR_' + str(int(time.time() * 1000)) + '_' + secrets.token_hex(3),
                'username': username,
                'passwordHash': _hash_password(password),
                'fullName': (data.get('fullName') or '').strip(),
                'email': (data.get('email') or '').strip(),
                'department': (data.get('department') or '').strip(),
                'requestedAt': time.strftime('%Y-%m-%dT%H:%M:%S')
            })
            _write_db('auth_pending_users', pending)
            _send_json(self, 200, {'success': True})
            return

        if self.path == '/api/save-pdf':
            if not self._require_session():
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                _send_json(self, 400, {'error': 'Empty request body'})
                return

            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                pdf_base64 = data.get('pdf_data')
                filename = data.get('filename')
                save_path = (data.get('save_path') or '').strip()  # optional local copy
                overwrite = data.get('overwrite', False)

                if not pdf_base64 or not filename:
                    _send_json(self, 400, {'error': 'Missing required fields: pdf_data or filename'})
                    return

                # Strip any directory components from the client-supplied filename
                # to prevent path traversal (e.g. "..\\..\\evil.pdf").
                filename = os.path.basename(filename.replace('\\', '/'))
                if not filename or filename in ('.', '..'):
                    _send_json(self, 400, {'error': 'Invalid filename'})
                    return

                # Clean up base64 header if present, then decode.
                if ',' in pdf_base64:
                    pdf_base64 = pdf_base64.split(',')[1]
                pdf_bytes = base64.b64decode(pdf_base64)

                # 1) Cloud archive — always upload to object storage when configured,
                #    regardless of the local save path, so the PDF is reachable
                #    anywhere. Upsert, so it never needs an overwrite prompt.
                cloud_saved = False
                if _STORAGE_ENABLED:
                    try:
                        _storage_put(filename, pdf_bytes, 'application/pdf')
                        cloud_saved = True
                    except Exception as _e:
                        print(f"[Storage] save-pdf upload failed for '{filename}': {_e}", flush=True)

                # 2) Optional local copy — only when the user configured a save path.
                local_path = None
                if save_path:
                    expanded_path = os.path.abspath(os.path.expanduser(os.path.expandvars(save_path)))
                    if _is_write_forbidden(expanded_path):
                        _send_json(self, 400, {'error': 'Refusing to write to a protected location. Choose a different save path.'})
                        return
                    full_path = os.path.join(expanded_path, filename)
                    # Prompt before overwriting an existing local file.
                    if os.path.exists(full_path) and not overwrite:
                        _send_json(self, 200, {'exists': True, 'path': full_path, 'savedToCloud': cloud_saved})
                        return
                    os.makedirs(expanded_path, exist_ok=True)
                    with open(full_path, 'wb') as f:
                        f.write(pdf_bytes)
                    local_path = full_path

                # 3) Legacy fallback: only when there is NO object storage AND no local
                #    path (e.g. an old local install) keep the DB blob so it isn't lost.
                if not _STORAGE_ENABLED and not save_path and _DB_POOL:
                    _conn = None
                    try:
                        _conn = get_valid_connection()
                        with _conn.cursor() as _cur:
                            _cur.execute("""
                                INSERT INTO vectis_uploads (filename, data, mime_type)
                                VALUES (%s, %s, %s)
                                ON CONFLICT (filename)
                                DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type;
                            """, (filename, psycopg2.Binary(pdf_bytes), 'application/pdf'))
                            _conn.commit()
                    except Exception as _e:
                        print(f"[DB] [ERROR] Saving PDF '{filename}' to PostgreSQL: {_e}", flush=True)
                        if _conn:
                            _conn.rollback()
                    finally:
                        if _conn:
                            _DB_POOL.putconn(_conn)

                _send_json(self, 200, {'success': True, 'savedToPath': local_path, 'savedToCloud': cloud_saved})

            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/upload-file':
            if not self._require_session():
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                _send_json(self, 400, {'error': 'Empty request body'})
                return

            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                file_base64 = data.get('file_data')
                filename = data.get('filename')
                upload_path = (data.get('upload_path') or '').strip()

                if not file_base64 or not filename:
                    _send_json(self, 400, {'error': 'Missing required fields: file_data or filename'})
                    return

                # Strip directory components to prevent path traversal.
                filename = os.path.basename(filename.replace('\\', '/'))
                if not filename or filename in ('.', '..'):
                    _send_json(self, 400, {'error': 'Invalid filename'})
                    return

                # Reject anything outside the document/image allowlist — a same-origin
                # .html/.svg/.js upload would otherwise be a stored-XSS vector.
                _ext = os.path.splitext(filename)[1].lower()
                if _ext not in self.ALLOWED_UPLOAD_EXTS:
                    _send_json(self, 400, {'error': 'File type not allowed.'})
                    return

                # Clean up base64 header if present
                if ',' in file_base64:
                    file_base64 = file_base64.split(',')[1]

                file_bytes = base64.b64decode(file_base64)

                # The upload folder is the per-user path sent by the client; the
                # database copy (below) is the source of truth, so a missing path
                # simply falls back to the app's local uploads directory.
                if upload_path:
                    uploads_dir = os.path.abspath(os.path.expanduser(os.path.expandvars(upload_path)))
                    if _is_write_forbidden(uploads_dir):
                        _send_json(self, 400, {'error': 'Configured upload path is inside the application directory.'})
                        return
                else:
                    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')

                base, ext = os.path.splitext(filename)
                counter = 1
                unique_filename = filename

                def _file_exists(fname):
                    # Check object storage (primary store when configured)
                    if _STORAGE_ENABLED and _storage_exists(fname):
                        return True
                    # Check local filesystem
                    if os.path.exists(os.path.join(uploads_dir, fname)):
                        return True
                    # Check database
                    if _DB_POOL:
                        _conn = None
                        try:
                            _conn = get_valid_connection()
                            with _conn.cursor() as _cur:
                                _cur.execute("SELECT 1 FROM vectis_uploads WHERE filename = %s;", (fname,))
                                return _cur.fetchone() is not None
                        except Exception:
                            return False
                        finally:
                            if _conn:
                                _DB_POOL.putconn(_conn)
                    return False

                while _file_exists(unique_filename):
                    unique_filename = f"{base}_{counter}{ext}"
                    counter += 1

                full_path = os.path.join(uploads_dir, unique_filename)

                # Local disk is only the durable store when object storage is off.
                # When Supabase is configured the local write is wasted (and fails
                # on a read-only/ephemeral cloud disk), so skip it entirely.
                if not _STORAGE_ENABLED:
                    os.makedirs(uploads_dir, exist_ok=True)
                    with open(full_path, 'wb') as f:
                        f.write(file_bytes)

                # Determine mime type from the extension.
                mime = 'application/octet-stream'
                if ext == '.pdf': mime = 'application/pdf'
                elif ext in ['.png']: mime = 'image/png'
                elif ext in ['.jpg', '.jpeg']: mime = 'image/jpeg'
                elif ext in ['.doc', '.docx']: mime = 'application/msword'

                # Persist the durable copy: object storage if configured, else DB blob.
                if _STORAGE_ENABLED:
                    try:
                        _storage_put(unique_filename, file_bytes, mime)
                    except Exception as _e:
                        print(f"[Storage] upload failed for '{unique_filename}': {_e}", flush=True)
                elif _DB_POOL:
                    _conn = None
                    try:
                        _conn = get_valid_connection()
                        with _conn.cursor() as _cur:
                            _cur.execute("""
                                INSERT INTO vectis_uploads (filename, data, mime_type)
                                VALUES (%s, %s, %s)
                                ON CONFLICT (filename)
                                DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type;
                            """, (unique_filename, psycopg2.Binary(file_bytes), mime))
                            _conn.commit()
                    except Exception as _e:
                        print(f"[DB] [ERROR] Writing upload '{unique_filename}' to PostgreSQL: {_e}", flush=True)
                        if _conn:
                            _conn.rollback()
                    finally:
                        if _conn:
                            _DB_POOL.putconn(_conn)

                # Return relative path for HTTP access (e.g. uploads/PO.pdf)
                relative_path = f"uploads/{unique_filename}"
                _send_json(self, 200, {'success': True, 'path': relative_path, 'filename': unique_filename})

            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/delete-file':
            if not self._require_session():
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                _send_json(self, 400, {'error': 'Empty request body'})
                return

            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                file_path = data.get('file_path')

                if not file_path:
                    _send_json(self, 400, {'error': 'Missing required fields: file_path'})
                    return

                # Prevent directory traversal attacks
                normalized_path = os.path.normpath(file_path).replace('\\', '/')
                if not normalized_path.startswith('uploads/'):
                    _send_json(self, 400, {'error': 'Invalid file path'})
                    return

                filename = os.path.basename(normalized_path)
                settings = _load_settings()
                custom_upload_path = settings.get('uploadSavePath', '').strip()
                if custom_upload_path:
                    uploads_dir = os.path.abspath(os.path.expanduser(os.path.expandvars(custom_upload_path)))
                else:
                    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')

                full_path = os.path.join(uploads_dir, filename)
                
                # Remove from object storage (primary store when configured).
                deleted_storage = False
                if _STORAGE_ENABLED:
                    deleted_storage = _storage_delete(filename)

                deleted_db = False
                if _DB_POOL:
                    _conn = None
                    try:
                        _conn = get_valid_connection()
                        with _conn.cursor() as _cur:
                            _cur.execute("DELETE FROM vectis_uploads WHERE filename = %s;", (filename,))
                            _conn.commit()
                            deleted_db = True
                    except Exception as _e:
                        print(f"[DB] [ERROR] Deleting upload '{filename}' from PostgreSQL: {_e}", flush=True)
                        if _conn:
                            _conn.rollback()
                    finally:
                        if _conn:
                            _DB_POOL.putconn(_conn)

                if os.path.exists(full_path):
                    os.remove(full_path)
                    _send_json(self, 200, {'success': True})
                elif deleted_db or deleted_storage:
                    _send_json(self, 200, {'success': True})
                else:
                    _send_json(self, 404, {'error': 'File not found'})

            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/save-backup':
            if not self._require_session():
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                _send_json(self, 400, {'error': 'Empty request body'})
                return

            post_data = self.rfile.read(content_length)
            try:
                import datetime
                data = json.loads(post_data.decode('utf-8'))
                backup_data = data.get('backup_data')
                backup_paths = data.get('backup_paths', [])

                if not backup_data or not backup_paths:
                    _send_json(self, 400, {'error': 'Missing required fields: backup_data or backup_paths'})
                    return

                saved_locations = []
                failed_locations = []

                # Format filename with datetime stamp
                timestamp = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = f"PO_QU_Backup_{timestamp}.json"

                # Write copy in DB if database mode is active
                if _DB_POOL:
                    _conn = None
                    try:
                        _conn = get_valid_connection()
                        with _conn.cursor() as _cur:
                            backup_bytes = json.dumps(backup_data, ensure_ascii=False).encode('utf-8')
                            _cur.execute("""
                                INSERT INTO vectis_uploads (filename, data, mime_type)
                                VALUES (%s, %s, %s)
                                ON CONFLICT (filename)
                                DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type;
                            """, (filename, psycopg2.Binary(backup_bytes), 'application/json'))
                            _conn.commit()
                            saved_locations.append(f"[DB] {filename}")
                    except Exception as _e:
                        print(f"[DB] [ERROR] Saving backup '{filename}' to PostgreSQL: {_e}", flush=True)
                        if _conn:
                            _conn.rollback()
                        failed_locations.append(f"[DB]: {str(_e)}")
                    finally:
                        if _conn:
                            _DB_POOL.putconn(_conn)

                for raw_path in backup_paths:
                    if not raw_path or not raw_path.strip():
                        continue
                    try:
                        expanded_path = os.path.abspath(os.path.expanduser(os.path.expandvars(raw_path.strip())))
                        if _is_write_forbidden(expanded_path):
                            raise ValueError('backup path inside application directory')
                        os.makedirs(expanded_path, exist_ok=True)
                        full_path = os.path.join(expanded_path, filename)
                        with open(full_path, 'w', encoding='utf-8') as f:
                            json.dump(backup_data, f, indent=2, ensure_ascii=False)
                        saved_locations.append(full_path)
                    except Exception as err:
                        print(f"Error saving backup to {raw_path}: {err}")
                        failed_locations.append(f"{raw_path}: {str(err)}")

                _send_json(self, 200, {
                    'success': len(saved_locations) > 0,
                    'saved_locations': saved_locations,
                    'failed_locations': failed_locations
                })

            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/db/save':
            sess = self._require_session()
            if not sess:
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                _send_json(self, 400, {'error': 'Empty request body'})
                return

            post_data = self.rfile.read(content_length)
            try:
                data_payload = json.loads(post_data.decode('utf-8'))
                key = data_payload.get('key')
                data = data_payload.get('data')

                # Account tables may only be modified by an admin. app_settings is
                # handled specially below: non-admins may edit the shared signature
                # fields and their own per-user save paths, but nothing else.
                admin_only = {'auth_users', 'auth_pending_users', 'auth_password_hash'}
                if key in admin_only and sess.get('role') != 'admin':
                    _send_json(self, 403, {'error': 'Admin privileges required to modify this data.'})
                    return

                if key not in _SAVEABLE_KEYS:
                    _send_json(self, 400, {'error': f'Invalid key: {key}'})
                    return

                # Tamper-proof audit log: a non-admin may append entries but must
                # not be able to delete or rewrite existing ones (covering tracks).
                # Admins may still clear/prune the log.
                if key == 'activity_log' and sess.get('role') != 'admin':
                    if not isinstance(data, list):
                        _send_json(self, 400, {'error': 'Invalid activity log payload.'})
                        return
                    data = _append_only_log(_read_db('activity_log', []), data)

                if key == 'app_settings' and isinstance(data, dict):
                    existing_settings = _read_db(key, {})
                    if not isinstance(existing_settings, dict):
                        existing_settings = {}

                    if sess.get('role') != 'admin':
                        # Non-admins may only touch the shared signature fields and
                        # their own per-user save paths. Everything else is taken
                        # from the existing settings, untouched.
                        incoming = data
                        merged = dict(existing_settings)
                        signature_fields = (
                            'signImagePoQu', 'signImagePoQuName',
                            'invSignImageDom', 'invSignImageDomName',
                            'invSignImage', 'invSignImageName',
                            'signName', 'signDesignation',
                        )
                        for f in signature_fields:
                            if f in incoming:
                                merged[f] = incoming[f]
                        # Per-user save paths: only the caller's own entry.
                        user = sess.get('user')
                        user_paths = merged.get('userPaths')
                        if not isinstance(user_paths, dict):
                            user_paths = {}
                        else:
                            user_paths = dict(user_paths)
                        inc_paths = incoming.get('userPaths')
                        if user and isinstance(inc_paths, dict) and isinstance(inc_paths.get(user), dict):
                            user_paths[user] = inc_paths[user]
                        merged['userPaths'] = user_paths
                        data = merged
                    else:
                        # Admins may write everything, but preserve sensitive keys
                        # that are never sent back to the client. (The retired AI
                        # scan's geminiApiKey is intentionally NOT preserved, so any
                        # legacy stored key is dropped on the next settings save.)
                        try:
                            for sensitive_key in ('smtpPassword',):
                                if sensitive_key in existing_settings and sensitive_key not in data:
                                    data[sensitive_key] = existing_settings[sensitive_key]
                        except Exception as merge_err:
                            print(f"Error merging existing settings: {merge_err}")

                _write_db(key, data)
                _send_json(self, 200, {'success': True})

            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/db/item':
            # Atomic single-document upsert/delete — concurrency-safe alternative
            # to the whole-array /api/db/save for document collections.
            if not self._require_session():
                return
            data = self._read_body() or {}
            key = data.get('key')
            op  = data.get('op')
            if key not in _ITEM_KEYS:
                _send_json(self, 400, {'error': f'Invalid key: {key}'})
                return
            if op not in ('upsert', 'upsertMany', 'delete'):
                _send_json(self, 400, {'error': 'Invalid op.'})
                return
            try:
                _mutate_db(key, lambda cur: (
                    _apply_item_op(cur, op, item=data.get('item'),
                                   items=data.get('items'), item_id=data.get('id')),
                    True))
                _send_json(self, 200, {'success': True})
            except Exception as e:
                _send_error(self, 500, e)

        elif self.path == '/api/db/next-serial':
            # Atomic server-side serial allocation so concurrent document
            # generation can never mint the same number twice.
            if not self._require_session():
                return
            data = self._read_body() or {}
            key = data.get('key')
            if key != 'document_counters':
                _send_json(self, 400, {'error': 'Invalid counter key.'})
                return
            doc_type = data.get('docType')
            op       = data.get('op', 'increment')
            if not doc_type or op not in ('increment', 'bump'):
                _send_json(self, 400, {'error': 'docType and a valid op are required.'})
                return
            month = data.get('month', '')
            fy    = data.get('fy', '')
            try:
                number = _mutate_db(key, lambda cur:
                    _apply_serial_op(cur, op, doc_type, month, fy, data.get('value', 0)))
                _send_json(self, 200, {'number': number})
            except Exception as e:
                _send_error(self, 500, e)

        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def end_headers(self):
        # Only echo a CORS origin back for local origins. A wildcard ('*') would
        # let any website the user visits read/write this local database and files.
        origin = self.headers.get('Origin', '')
        host = urllib.parse.urlparse(origin).hostname if origin else None
        if host in ('localhost', '127.0.0.1', '::1'):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        # Caching policy — cut needless re-downloads on every refresh without
        # ever serving stale code.
        _p_full = self.path
        _p = _p_full.split('?', 1)[0].lower()
        _query = _p_full.split('?', 1)[1] if '?' in _p_full else ''
        if _p == '/' or _p.endswith('.html') or _p.startswith('/api'):
            # Entry point + dynamic data: always revalidate. (/api/db pairs this
            # with an ETag so revalidation usually returns a tiny 304.)
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        elif _p.endswith(('.js', '.css')):
            if 'v=' in _query:
                # Versioned assets (…?v=1.2.3) are effectively immutable: a deploy
                # bumps the query string, so the browser can cache them forever
                # and skip the request entirely until the version changes.
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            else:
                self.send_header('Cache-Control', 'no-cache, must-revalidate')
        elif _p.endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
                          '.ico', '.woff', '.woff2', '.ttf')):
            # Images/fonts rarely change — cache for a day (still revalidated via
            # Last-Modified afterwards).
            self.send_header('Cache-Control', 'public, max-age=86400')

        # Mitigate clickjacking / content-sniffing / referrer leakage for the served UI.
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
        # HSTS — once seen over HTTPS, the browser refuses to talk to this host over
        # plain HTTP for a year (blocks SSL-strip downgrade). Only emitted on HTTPS so
        # local/LAN HTTP use is unaffected.
        if _TLS_ENABLED or self.headers.get('X-Forwarded-Proto', '').lower() == 'https':
            self.send_header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
        # Content-Security-Policy: restrict script/style/object origins as
        # defense-in-depth against injection. 'unsafe-inline' is still required
        # because the UI relies on inline event handlers and styles; even so this
        # locks scripts to self + the known CDNs, forbids plugins/embeds, and
        # prevents the page from being framed or having its <base> hijacked.
        self.send_header('Content-Security-Policy', (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "worker-src 'self' blob: https://cdnjs.cloudflare.com; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'self'"
        ))
        super().end_headers()

if __name__ == '__main__':
    # ── Direct HTTPS (no proxy) ──
    # If a TLS certificate + key are present the server speaks HTTPS itself, so
    # passwords/cookies are encrypted without needing Caddy/Nginx in front.
    #   • cert/key paths: env VECTIS_CERT / VECTIS_KEY, else certs/cert.pem +
    #     certs/key.pem next to this file.
    cert = os.environ.get('VECTIS_CERT') or os.path.join(_APP_ROOT, 'certs', 'cert.pem')
    key  = os.environ.get('VECTIS_KEY')  or os.path.join(_APP_ROOT, 'certs', 'key.pem')
    use_tls = os.path.exists(cert) and os.path.exists(key)

    # With TLS it's safe to listen on all interfaces (traffic is encrypted);
    # without it, default to localhost so cleartext never leaves the machine.
    # On cloud environments (e.g. Render), respect the PORT env var and bind to all interfaces.
    # Check CLI arguments for port: python3 server.py [port]
    cli_port = None
    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            if arg.isdigit():
                cli_port = int(arg)
                break

    default_port = 443 if use_tls else 8000
    base_port = cli_port or int(os.environ.get('PORT') or os.environ.get('VECTIS_PORT') or str(default_port))
    default_host = '0.0.0.0' if (use_tls or os.environ.get('PORT')) else '127.0.0.1'
    host = os.environ.get('VECTIS_HOST', default_host)

    httpd = None
    port = base_port
    allow_fallback = not bool(os.environ.get('PORT'))
    max_attempts = 20 if allow_fallback else 1

    for attempt in range(max_attempts):
        try:
            curr_port = base_port + attempt
            httpd = ThreadingHTTPServer((host, curr_port), CustomHandler)
            port = curr_port
            break
        except OSError as e:
            if getattr(e, 'errno', None) == 48 and attempt < max_attempts - 1:
                print(f"[Server] Port {curr_port} is already in use, trying port {curr_port + 1}...", flush=True)
                continue
            raise

    # Restore sessions saved before the last restart so users aren't logged out
    # (with "Session expired") every time the server redeploys or restarts.
    _load_sessions()

    # Data-loss guard: on a cloud host (PORT set) with no Postgres, all data lives
    # in local JSON on an ephemeral disk and is WIPED on every redeploy. Warn loudly.
    if os.environ.get('PORT') and not _DB_POOL:
        print("=" * 70, flush=True)
        print("[DB] CRITICAL: running on a cloud host with NO DATABASE_URL set.", flush=True)
        print("[DB] Data is being written to LOCAL JSON on an EPHEMERAL disk and", flush=True)
        print("[DB] WILL BE LOST on the next redeploy/restart. Set DATABASE_URL to a", flush=True)
        print("[DB] persistent Postgres instance before using this in production.", flush=True)
        print("=" * 70, flush=True)

    if _STORAGE_ENABLED:
        print(f"[Storage] File object storage ENABLED -> Supabase bucket '{_SUPABASE_BUCKET}'", flush=True)
        # Boot-time self-test: write then delete a tiny object so the logs show
        # immediately whether uploads actually work (and the exact error if not).
        try:
            _storage_put('.vectis-healthcheck.txt', b'ok', 'text/plain')
            _storage_delete('.vectis-healthcheck.txt')
            print("[Storage] Self-test OK — uploads to the bucket are working.", flush=True)
        except urllib.error.HTTPError as _e:
            _b = _e.read().decode('utf-8', 'replace')[:300]
            print(f"[Storage] SELF-TEST FAILED: HTTP {_e.code} {_b}", flush=True)
            print("[Storage] Check: bucket name matches SUPABASE_BUCKET, and SUPABASE_SERVICE_KEY is the service_role key (not anon).", flush=True)
        except Exception as _e:
            print(f"[Storage] SELF-TEST FAILED: {_e}", flush=True)
    else:
        print("[Storage] Object storage not configured; using Postgres/disk for files.", flush=True)

    if use_tls:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(certfile=cert, keyfile=key)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        _TLS_ENABLED = True
        print(f"Vectis Server started with HTTPS on {host}:{port}", flush=True)
    else:
        print(f"Vectis Server started on {host}:{port} (HTTP — localhost only)", flush=True)
        print("WARNING: no TLS certificate found, so this serves plain HTTP.", flush=True)
        print("  Passwords would travel in CLEARTEXT over a network. Add a cert at", flush=True)
        print("  certs\\cert.pem + certs\\key.pem before hosting on the internet", flush=True)
        print("  (see docs/deployment.md). Set VECTIS_HOST=0.0.0.0 for LAN-only use.", flush=True)

    # Loudly warn if the admin account is still on the default password — anyone
    # who has seen this code knows it, so it must be changed before going live.
    if _verify_password('admin123', _admin_hash()):
        print("\n" + "!" * 64, flush=True)
        print("  SECURITY WARNING: the admin account is using the DEFAULT", flush=True)
        print(f"  password 'admin123'. Log in as '{ADMIN_USERNAME}' and change it", flush=True)
        print("  now (Settings > change password) before exposing this server.", flush=True)
        print("!" * 64 + "\n", flush=True)

    httpd.serve_forever()
