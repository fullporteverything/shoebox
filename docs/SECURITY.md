# Security design and what's left before launch

## Threat model for this version

This version is **local-first**: the vault lives in the browser's IndexedDB.
There is no server holding user data, so there is no server database to
breach. The main risks are on the device itself.

| Threat | Defence | Response |
|---|---|---|
| Someone reads the browser's storage | AES-256-GCM on every record; key wrapped by a PBKDF2-derived key (600k iterations) | Unreadable without the password |
| Records edited, swapped or deleted in storage | AEAD tags bound to user and record id, an HMAC-signed index, a canary record | **Shred** (checked at unlock and every 45 s while open) |
| Password guessing | Lockouts after 3 misses, doubling up to 1 hour | **Shred** at your limit (5, 10 or never) |
| Malicious extension or injected script | MutationObserver for scripts, frames, embeds and inline handlers added after boot; strict CSP when deployed | Lock (default) or **shred** (strict mode) |
| Session from a new browser or time zone | Fingerprint compared with the last unlock | Alert |
| Unattended unlocked screen | Idle lock (5, 15 or 30 min); keys exist only in memory | Lock |
| Several tabs open | BroadcastChannel; Web Locks serialize writes across tabs | Every tab locks or shreds together |

Writes are atomic: the record and the re-signed index commit in one IndexedDB
transaction under a cross-tab lock, so a crash or a race can't leave a
signature mismatch that would cause a false shred.

## Honest limits

- **Client-side sensors can be bypassed by an attacker who controls the
  device.** Lockout counters are stored next to the vault; someone with
  storage access could reset them. They still face PBKDF2 for every guess.
- Clearing site data deletes the vault. There is no backup or sync yet.
- Injected-code detection is a tripwire, not a guarantee.

## Before a public launch

1. **Server sync with zero-knowledge storage.** Store the same ciphertext
   server-side so data survives a cleared browser. Keep encryption
   client-side.
2. **Server-enforced auth and lockouts.** Use real accounts (email
   verification, optional passkeys/WebAuthn, MFA). Enforce rate limits and
   lockouts on the server, where an attacker can't reset them.
3. **Server-side breach detection.** Add anomaly detection on logins,
   impossible travel, credential-stuffing patterns, and alerting. On a
   confirmed breach, revoke sessions and rotate keys. Optionally run a
   server-triggered shred: delete the stored ciphertext and wrapped keys,
   then tell every client to shred on next contact.
4. **Shared rate limiting** on `api/analyze` (Vercel KV, Upstash, or the
   Vercel WAF). The in-memory limiter only covers one instance.
5. **Logging without content.** Never log document images or extracted
   fields.
6. **A written information security plan (WISP).** The FTC Safeguards Rule
   requires one if you're a "financial institution" under GLBA, which can
   include tax-preparation services. See IRS Publication 5708.
7. **Independent penetration test** before handling real users' data.
8. **Incident response runbook** with state breach-notification timelines.
