# Security design and what's left before launch

## Threat model for this version

Encryption happens in the browser. Each browser keeps an encrypted copy of
the vault in IndexedDB, and the same ciphertext is synced to a Supabase
Postgres database so the account opens on any device. The server never sees
a password, a data key or a decrypted record.

| Threat | Defence | Response |
|---|---|---|
| Someone reads the browser's storage or the server database | AES-256-GCM on every record; data key wrapped by a PBKDF2-derived key (600k iterations) | Unreadable without the password |
| Records edited, swapped or deleted (in the browser or on the server) | AEAD tags bound to user and record id, an HMAC-signed index (key never leaves the browser), a canary record. Every download is checked against the signature before it's used | **Shred** (checked at unlock, on every sync, and every 45 s while open) |
| Password guessing | Server-side lockouts after 3 misses, doubling up to 1 hour. The browser can't reset them | Lockout only. Wrong passwords never wipe, so knowing an email isn't enough to destroy someone's data |
| Stolen password | Optional TOTP two-factor checked **by the server** (RFC 6238, replay-protected, one-time hashed recovery codes). The server won't release the wrapped key or any record until the code passes | Lockout, then **shred** at the wipe limit (counts wrong codes after a correct password) |
| Stolen session, or a lost device | Session tokens live only in memory, expire after 12 h idle, and are stored server-side as hashes. Profile → Settings lists every device and can sign any or all of them out; a signed-out device erases its local copy on next contact | Sign out |
| New device | First sign-in from a device is logged and listed; a browser or time-zone change is flagged | Alert |
| Malicious extension or injected script | MutationObserver for scripts, frames, embeds and inline handlers added after boot; strict CSP when deployed | Lock (default) or **shred** (strict mode) |
| Unattended unlocked screen | Idle lock (5, 15 or 30 min); keys exist only in memory | Lock |
| Several tabs open | BroadcastChannel; Web Locks serialize writes and syncs across tabs | Every tab locks or shreds together |

### How sign-in works without the server learning the password

PBKDF2 runs once in the browser. Its output is the key-encryption key, which
never leaves the device, and HKDF of it with the label `server-auth` is a
sign-in proof. The server stores `sha256(proof)` and compares. Knowing the
proof (or its hash) doesn't reveal the key-encryption key, and the server
copy is no easier to attack offline than the browser copy: both need PBKDF2
per guess.

### How sync stays consistent

Every change carries the server revision it was built on. If another device
pushed first, the server answers "conflict"; the browser pulls the new rows,
keeps its own unpushed edits, re-signs and tries again. Each push includes an
index signature over exactly the rows the server will hold afterwards, so the
server copy always verifies by itself. Pending edits are kept in IndexedDB,
so a closed tab or lost connection doesn't drop them.

### Server surface

Tables live in a private `shoebox` schema that the API doesn't expose, and
the anon role has no grants on it. The only entry points are the
`public.shoebox_*` functions (`SECURITY DEFINER`, empty `search_path`), each
of which checks a session token or, for sign-in, the password proof. Schema:
`supabase/migrations/20261011000000_shoebox_sync.sql`.

Writes are atomic: in the browser, the record and the re-signed index commit
in one IndexedDB transaction under a cross-tab lock; on the server, each push
is one transaction that checks the revision under a row lock.

## Honest limits

- **Email isn't verified yet.** Anyone can register an email address they
  don't own. Add verification before launch (item 1).
- **No password recovery.** Forgetting the password loses the vault: that's
  the cost of the server not holding keys. Offer a printable recovery key
  before launch.
- **Concurrent edits to the same record:** the last device to sync wins for
  that record. Different records merge cleanly.
- **Offline fallback.** If the server can't be reached, a browser that already
  has a copy can open it with the password. Lockouts are then local only.
- Injected-code detection is a tripwire, not a guarantee.

## Before a public launch

1. **Email verification and rate limits per IP** on the sign-in functions
   (Supabase Edge Functions or the Vercel WAF in front of them). Optional
   passkeys/WebAuthn.
2. **Recovery key** shown once at sign-up, so a forgotten password isn't
   the end of the vault.
3. **Server-side anomaly detection:** impossible travel, credential-stuffing
   patterns, alerting on bursts of lockouts.
4. **Shared rate limiting** on `api/analyze` (Vercel KV, Upstash, or the
   Vercel WAF). The in-memory limiter only covers one instance.
5. **Logging without content.** Never log document images or extracted
   fields.
6. **A written information security plan (WISP).** The FTC Safeguards Rule
   requires one if you're a "financial institution" under GLBA, which can
   include tax-preparation services. See IRS Publication 5708.
7. **Independent penetration test** before handling real users' data.
8. **Incident response runbook** with state breach-notification timelines.
