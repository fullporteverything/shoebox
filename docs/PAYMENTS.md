# Tax Year Pass payments (Stripe)

One-time Stripe Checkout payment per tax year. No subscriptions, nothing
renews. $39 for founding members (joined before 2027-01-01) every year they
keep it without a gap; $59 otherwise. The price is decided by the database
(`shoebox.pass_price`), never by the browser.

## Pieces

| Piece | Where |
|---|---|
| `shoebox.passes` table, pricing, `shoebox_passes` RPC | `supabase/migrations/20261011030000_tax_year_pass.sql` |
| Starts checkout (`POST /functions/v1/shoebox-checkout`) | `supabase/functions/shoebox-checkout` |
| Records paid / refunded passes (Stripe webhook) | `supabase/functions/shoebox-stripe-webhook` |
| Pass page, gates | `src/pages/Pass.tsx`, `PASS_REQUIRED_FROM` in `src/lib/cloud.ts` |

Every pass feature is free for everyone until `PASS_REQUIRED_FROM`
(2027-01-01). After that the filing pack and quarterly planner need a paid
pass for the profile's tax year.

## Switching it on

1. Stripe dashboard → Developers → API keys. Copy the **secret key**
   (start with the `sk_test_…` one).
2. Supabase → Edge Functions → Secrets → add
   `SHOEBOX_STRIPE_SECRET_KEY` = that key. (Use this name, not
   `STRIPE_SECRET_KEY`: other apps in this Supabase project already have one.)
3. Stripe → Developers → Webhooks → Add endpoint:
   `https://ovxykjbnpozndcgxkqwg.supabase.co/functions/v1/shoebox-stripe-webhook`
   with events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded` and `charge.refunded`.
4. Copy the endpoint's **signing secret** (`whsec_…`) into Supabase as
   `SHOEBOX_STRIPE_WEBHOOK_SECRET`.
5. Test: Profile → Founding member → See the Tax Year Pass → Get the pass,
   card `4242 4242 4242 4242`, any future date and CVC. The page should
   say the pass is active within a few seconds.
6. Going live: repeat 1–4 with the live key and a live-mode webhook.

## Refunds

Refund in the Stripe dashboard. The `charge.refunded` webhook marks the pass
refunded and the gates close again. The terms promise a full refund on
request within 30 days.

## Not done yet

- Sales tax: some states tax digital services. Turn on Stripe Tax and add
  `automatic_tax[enabled]=true` to the checkout function when you're ready.
- Gates run in the browser. The data is the user's own and stays on their
  device, so this is about convenience, not secrecy.
