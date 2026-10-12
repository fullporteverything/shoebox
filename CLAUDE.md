# Working on Shoebox

## Always deploy
The owner wants every change deployed by Claude, every time, without being asked
and no matter which chat or channel the request came from. Finished work isn't
done until it's live and checked:

1. Run `npx tsc --noEmit`, `npm test` and `npm run build`.
2. Push to `main`. Vercel (team `acenv1`, project `shoebox`) builds it and serves
   https://www.shoeboxx.io and https://shoebox-psi.vercel.app.
3. Apply any new `supabase/migrations/*.sql` to the Supabase project
   `ovxykjbnpozndcgxkqwg` (the Supabase MCP `apply_migration`). SQL containing
   DELETE may need the owner's approval; if that prompt can't reach them, give
   them the exact SQL to paste in the SQL editor.
4. Deploy changed edge functions in `supabase/functions/`.
5. Confirm it's live (fetch the site and check the new bundle or response),
   then tell the owner it's deployed.

If Vercel or Supabase access fails, say so plainly with what's blocked and what
the owner needs to reconnect. Never leave work undeployed without telling them.

## Things to keep in mind
- The Supabase project is shared with other apps: everything is in the private
  `shoebox` schema behind `public.shoebox_*` functions. Stripe secrets are named
  `SHOEBOX_STRIPE_*`.
- Never invent stats, reviews or counters. Reviews are approved on content, never rating.
- Commit messages must not name an AI model.
