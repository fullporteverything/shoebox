// Legal documents, written as templates for counsel to finish. Anything in
// [brackets] must be filled in before launch. docs/LEGAL_CHECKLIST.md lists
// the laws a lawyer should check these against.
//
// Format: "# " title, "## " section, "- " list item, "**bold**", blank-line paragraphs.

export const TERMS_VERSION = '2026-10-10'
export const COMPANY = '[Company legal name]'
export const CONTACT = '[legal@yourdomain.com]'

export type LegalDoc = { slug: string; title: string; short: string; summary: string; body: string }

export const legalDocs: LegalDoc[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    short: 'Terms',
    summary: 'The agreement between you and us for using Shoebox.',
    body: `
## 1. Who we are and what this is
These Terms of Service ("Terms") are an agreement between you and ${COMPANY} ("we", "us"). They cover your use of the Shoebox website, apps and related services (the "Service"). By creating an account or using the Service, you agree to these Terms. If you don't agree, don't use the Service.

## 2. Shoebox is not a tax preparer and does not give tax advice
Shoebox helps you **organize** receipts and documents and **suggests** how they might be categorized under general federal and state tax rules. It does not prepare or file tax returns, and it does not give legal, tax, accounting or financial advice. Categories, deductible amounts and notes are estimates that may be wrong, incomplete or out of date. Tax law changes often and depends on your individual facts.

You are responsible for your tax returns and for checking everything Shoebox suggests. Consult a qualified tax professional (a CPA, enrolled agent or tax attorney) before relying on any output. Nothing in the Service creates a professional-client relationship.

## 3. Eligibility and accounts
You must be at least 18 and able to form a binding contract. You must give accurate account information and keep your password secret. You are responsible for everything that happens under your account.

**Your password protects your encryption key.** We never receive your password or your key. If you forget your password, we cannot recover your data. Keep your own backups of important records.

## 4. Security features, including automatic shredding
The Service includes security features that may **permanently destroy your stored data** without warning. This happens if the Service detects signs of compromise, if too many wrong passwords are entered (under the policy you choose), or if you start a shred yourself. Shredded data cannot be recovered by you or by us. You agree that we are not liable for data destroyed by these features working as designed or by a false positive. Keep originals of any document you are legally required to retain. The IRS generally expects you to keep records for at least three years.

## 5. Your content
You keep all rights to the documents and information you upload ("Your Content"). You give us a limited license to process Your Content only to provide the Service to you, as described in our Privacy Policy. You confirm you have the right to upload Your Content and that it doesn't violate anyone's rights or the law.

## 6. AI features
Some features send document images to a third-party AI provider to read them. AI output can be inaccurate. Review every extracted amount, date and category before you confirm it. See the AI and Tax Disclaimer.

## 7. Acceptable use
You agree not to:
- use the Service for anyone else's records without their authorization;
- upload malware, or try to probe, scan, attack or reverse-engineer the Service or its security features;
- use the Service to prepare false or fraudulent tax filings;
- resell or provide the Service to others without our written permission;
- break any law, including tax, privacy and export laws.

## 8. Fees
[If the Service is paid: describe plans, billing cycle, renewals, cancellation, refunds and taxes here. Automatic-renewal laws in several states require specific disclosures and an easy online cancellation.]

## 9. Changes and termination
We may change the Service or these Terms. If a change is material, we will notify you in the app or by email at least [30] days before it takes effect, and you can stop using the Service before then. You may close your account at any time from your Profile; closing it deletes your vault from that device. We may suspend or end access if you breach these Terms or if required by law.

## 10. Disclaimers
THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE". TO THE FULLEST EXTENT ALLOWED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT ANY TAX CATEGORY, AMOUNT OR NOTE IS CORRECT, OR THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.

## 11. Limitation of liability
TO THE FULLEST EXTENT ALLOWED BY LAW, WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, DATA, TAX BENEFITS, PENALTIES OR INTEREST. OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM OR [$100]. Some jurisdictions don't allow these limits, so they may not apply to you.

## 12. Indemnity
You will defend and indemnify us against third-party claims arising from Your Content, your misuse of the Service or your breach of these Terms.

## 13. Disputes
[Counsel to choose: governing law (State of [__]); courts or arbitration; whether to include a class-action waiver and a small-claims carve-out; and the 30-day informal resolution period. Arbitration clauses must be conspicuous and meet the provider's consumer rules to be enforceable.]

## 14. Contact
${COMPANY}, [mailing address]. ${CONTACT}.
`,
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    short: 'Privacy',
    summary: 'What we collect, where it lives, and who can see it.',
    body: `
## The short version
- Your receipts, documents and profile are **encrypted in your browser** with a key only your password can unlock. We can't read them.
- When you ask Shoebox to read a document, the image is sent to our AI provider to extract the text, then discarded. We don't keep it on our servers.
- We don't sell or share your personal information, and we don't use it for advertising.

## What we collect
**Information you give us:** your email address, name, state, filing status, work type and business name; and the documents and notes you upload.

**Information created when you use Shoebox:** categories, amounts and notes; and a security log of events such as unlocks, lockouts and sensor alerts. These are stored encrypted with your documents.

**Technical information:** to run the website, our hosting provider processes standard request data such as IP address, browser type and request time, as described in its own policy. [List any analytics tool here, or state that none is used.]

## Where your information is stored
In this version, your vault lives in your browser's storage on your device, encrypted with AES-256-GCM. Your password is stretched with PBKDF2 (600,000 iterations) to unwrap the key, and the password itself is never stored or sent. Clearing your browser data deletes your vault. [If server sync is added: describe server storage, encryption, region and retention here.]

## How documents are read (AI processing)
When AI reading is on, each document image is downscaled and stripped of photo metadata on your device, then sent over an encrypted connection to [our server and] our AI provider, [Anthropic, PBC]. The provider uses it only to return the extracted fields. [Confirm the provider's data retention and no-training terms in your commercial agreement, and state them here precisely.] If you'd rather not use AI, you can enter details by hand.

## How we use information
To provide and secure the Service, respond to you, meet legal obligations, and enforce our Terms. We don't make decisions about you that have legal or similarly significant effects based solely on automated processing.

## Sharing
We share information only with service providers who help us run Shoebox (hosting and AI processing) under contracts that limit their use of it; when the law requires it; or to protect rights and safety. We do not sell or "share" personal information as those terms are defined under California law, and we don't use it for targeted advertising.

## Your choices and rights
You can view, edit, export or delete your information in the app at any time. Deleting your account erases your vault from the device. Depending on where you live, you may have rights to access, correct, delete or port your information, and to appeal a decision we make about a request. Contact ${CONTACT}. We won't discriminate against you for exercising these rights.

## Security and breaches
See our Security and Breach Policy. If a breach affects your personal information, we will notify you and the authorities as the law requires.

## Children
Shoebox is not for anyone under 18, and we don't knowingly collect information from children.

## Changes
We'll post changes here and update the effective date. Material changes will be announced in the app.

## Contact
${COMPANY}, [mailing address]. ${CONTACT}.
`,
  },
  {
    slug: 'security',
    title: 'Security and Breach Policy',
    short: 'Security',
    summary: 'How Shoebox protects your data, and what happens if something goes wrong.',
    body: `
## How your data is protected
- **Encryption at rest:** every record is sealed with AES-256-GCM using a random data key. The data key is wrapped with a key derived from your password (PBKDF2-SHA-256, 600,000 iterations, unique salt).
- **Tamper evidence:** each record is bound to your account and its own ID. The vault index is signed with HMAC-SHA-256, and a canary record must decrypt to a known value on every unlock.
- **Minimization:** images are downscaled and stripped of metadata such as GPS location before they are stored or sent anywhere.
- **Transport:** all traffic uses TLS. The site sends strict security headers, including a Content Security Policy that blocks third-party scripts, HSTS, and frame protection.

## Breach sensors
Shoebox watches for signs of compromise while you use it:
- **Vault integrity:** stored data changed outside the app. Response: shred.
- **Password guessing:** repeated wrong passwords. Response: growing lockouts, then a shred at the limit you choose.
- **Code injection:** scripts or frames added to the page after it loads. Response: lock, or shred in strict mode.
- **New device signature:** an unlock from a different browser or time zone. Response: alert.
- **Idle lock and tab sync:** forget the keys when you step away, and lock every tab together.

## What "shred" means
Shredding destroys the encryption key and deletes every encrypted record from the device. This is called crypto-shredding: without the key the data can't be decrypted by anyone, including us. **It is permanent.** You'll see an incident report listing what was destroyed and why.

## Limits
Sensors that run in your browser can only see what your browser sees. They cannot protect a device that is already fully compromised, for example by malware with administrator access, and no system is perfectly secure. Keep your device updated and use a strong, unique password.

## Reporting a vulnerability
Email [security@yourdomain.com]. We welcome good-faith research and won't pursue researchers who follow this policy: give us reasonable time to fix the issue before disclosing it, and don't access other people's data.

## If a breach happens
We will investigate promptly, contain it, and notify affected users and regulators within the timelines required by applicable state breach-notification laws [and the FTC Safeguards Rule, if applicable].
`,
  },
  {
    slug: 'disclaimer',
    title: 'AI and Tax Disclaimer',
    short: 'Disclaimer',
    summary: 'What the AI does, where it can be wrong, and what stays your call.',
    body: `
## Not tax advice
Shoebox organizes records and suggests categories using general summaries of IRS publications and state rules. It is not a CPA, an enrolled agent, an attorney or a tax preparer, and nothing it shows is tax, legal or financial advice.

## How suggestions are made
1. An AI model reads the document and extracts the merchant, date, amounts and a suggested category.
2. A rules engine checks that suggestion against the profile you gave us (work type and state). It applies known limits, such as 50% for most business meals, $25 per person for business gifts, and the 7.5%-of-AGI floor for medical costs, and it adds state notes.
3. **You** confirm or change it. Nothing counts until you confirm it.

## Where it can be wrong
- AI can misread blurry, faded, handwritten or foreign-language documents.
- Whether something is deductible usually depends on facts a receipt doesn't show, such as business purpose, business-use percentage, reimbursement and your income.
- Rules change. The rules in this version were last reviewed in [October 2026]. State conformity with federal law varies and changes each year.
- Deductible amounts shown are before overall limits like the SALT cap, AGI floors, the standard deduction, and self-employment tax effects.

## Your responsibility
Check every item and keep your original records. Ask a qualified professional about your situation before filing.
`,
  },
]

export const legalBySlug = Object.fromEntries(legalDocs.map((d) => [d.slug, d])) as Record<string, LegalDoc>
