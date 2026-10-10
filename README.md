# Shoebox

Snap every receipt. Shoebox reads it with Claude, sorts it by federal and state
tax rules, and keeps it encrypted on your device.

> **Status: working prototype.** Accounts, encryption, breach sensors, AI
> reading and the rules engine all work. Before a public launch, read
> [docs/SECURITY.md](docs/SECURITY.md) (what still needs a server) and
> [docs/LEGAL_CHECKLIST.md](docs/LEGAL_CHECKLIST.md), and have an attorney
> finish the legal templates in `src/legal/content.ts`.

## What it does

- **Inbox:** drag in photos or take one with the phone camera. Each document is
  downscaled, stripped of EXIF/GPS, read by Claude, then checked by the rules
  engine. Nothing counts until you confirm it.
- **Rules engine** (`src/lib/tax/`): 27 categories mapped to Schedule C lines,
  Schedule A, credits and income forms. It applies the limits it knows (50%
  meals, $25 gifts, $2,500 de minimis, W-2 employees can't deduct work
  expenses, $250 charity acknowledgments, $75 receipt rule) and adds state
  notes for all 50 states plus DC.
- **Accounts:** sign-up, sign-in, profile, password change, delete account.
- **Security center:** six breach sensors, a policy you control, an encrypted
  event log, a tamper drill and a manual shred.
- **Legal:** Terms of Service, Privacy Policy, Security and Breach Policy, and
  an AI and Tax Disclaimer, accepted (with version) at sign-up.

## How the security works

```
password --PBKDF2 (600k)--> KEK --AES-GCM--> wrapped data key (stored)
data key --AES-256-GCM--> every record (bound to user + record id)
data key --HKDF--> HMAC key --> signed index of every record + a canary
```

If a sensor detects tampering, password guessing past your limit, or (in
strict mode) injected code, the vault **crypto-shreds**: the wrapped key and
every record are deleted. Without the key nothing can be decrypted.

## AI reading

`src/lib/ai.ts` picks an engine:

| Where it runs | Engine |
|---|---|
| claude.ai artifact preview | Claude on the viewer's account (`sample` capability) |
| Deployed on Vercel with `ANTHROPIC_API_KEY` | `api/analyze.ts` → Claude Opus 5.5, structured output, server-side refusal fallback |
| Neither | Manual entry; the rules engine still sorts it |

The prompt is shared (`src/lib/prompt.ts`) and every model answer is
re-validated (`normalizeExtraction`) before the rules engine sees it.

## Run it

```sh
npm install
npm run dev            # http://localhost:5173 (manual mode unless the API is running)
npm test               # rules engine tests
npm run build          # typecheck + production build
npm run build:artifact # single-file preview build
```

## Deploy (Vercel)

1. Import the repo in Vercel. The framework (Vite), build command and output
   directory come from `vercel.json`.
2. Add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables.
3. Deploy. `vercel.json` also sends a strict CSP, HSTS, frame denial and other
   security headers.

## Layout

```
api/analyze.ts           Vercel function: document → structured fields via Claude
src/lib/crypto.ts        WebCrypto helpers (PBKDF2, AES-GCM, HKDF, HMAC)
src/lib/vault.ts         IndexedDB vault, atomic signed writes, shredding
src/lib/sentinel.ts      breach sensors
src/lib/session.tsx      session state, sensor wiring, lock/shred
src/lib/tax/             categories, state notes, classifier (+ tests)
src/legal/content.ts     legal templates
src/pages/, components/  UI
```
