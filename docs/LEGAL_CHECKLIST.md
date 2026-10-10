# Legal checklist for counsel

The documents in `src/legal/content.ts` are **templates**. Have a licensed
attorney review and finish them for your entity and states of operation. This
list is a starting point for that conversation, not legal advice.

## Fill in
- [ ] Company legal name, address, contact emails (`[brackets]` throughout)
- [ ] Governing law, venue, arbitration or courts, class-action waiver (Terms §13)
- [ ] Fees, renewals and cancellation, if paid (Terms §8; state automatic-renewal laws)
- [ ] The AI provider's actual retention and no-training terms (Privacy, AI processing)
- [ ] Analytics or other processors, if any (Privacy)

## Laws and rules to check against
- [ ] **FTC Safeguards Rule (GLBA):** may apply to tax-preparation-adjacent
      services. It requires a WISP, a qualified individual, risk assessments,
      encryption, MFA, and FTC notice of certain breaches.
- [ ] **IRC §7216 and §6713:** limits on disclosure and use of tax return
      information by preparers. Confirm whether Shoebox is a "tax return
      preparer" under these rules. It organizes records and doesn't prepare
      returns, but confirm.
- [ ] **Unauthorized practice / Circular 230:** keep the product out of
      individualized tax advice unless credentialed professionals are involved.
- [ ] **State breach-notification laws** (all 50 states, DC and territories):
      timelines, regulator notice, content of notices.
- [ ] **State privacy laws:** CCPA/CPRA and other comprehensive state laws
      (thresholds, rights requests, sensitive data, privacy notice content).
- [ ] **AI-specific laws:** state AI disclosure and automated-decision rules
      (for example Colorado's AI Act and Utah's disclosure law). Confirm
      current effective dates.
- [ ] **E-SIGN / UETA:** click-wrap acceptance at sign-up is recorded with the
      terms version; confirm this is enough evidence of assent.
- [ ] **COPPA:** the service is 18+; age gate at sign-up.
- [ ] **Accessibility (ADA / WCAG 2.2 AA).**
- [ ] **FTC Act §5:** security and privacy claims in marketing must match
      reality (e.g. "zero knowledge", "shreds itself").

## Product facts counsel will ask about
- Data is encrypted client-side; the operator can't read stored records.
- Document images go to the AI provider only to extract fields; nothing is
  stored server-side in this version.
- Automatic shredding can destroy data without warning; users accept this at
  sign-up.
