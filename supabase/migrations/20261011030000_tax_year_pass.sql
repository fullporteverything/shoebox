-- Tax Year Pass purchases. One-time payment per tax year, no auto-renewal.
-- Written only by the Stripe webhook (an Edge Function with the service
-- role), read by the app through shoebox_passes.

create table if not exists shoebox.passes (
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  tax_year int not null check (tax_year between 2020 and 2100),
  amount int not null,          -- cents actually paid
  currency text not null default 'usd',
  founding boolean not null default false,
  stripe_session text not null unique,
  payment_intent text unique,
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  created_at timestamptz not null default now(),
  primary key (user_id, tax_year)
);
alter table shoebox.passes enable row level security;
revoke all on shoebox.passes from public, anon, authenticated;

-- $39 for founding members (joined before 2027) as long as they haven't
-- skipped a year: their first pass, or one right after a year they had.
create or replace function shoebox.pass_price(p_user text, p_year int) returns jsonb language plpgsql stable set search_path = '' as $$
declare j timestamptz; any_paid boolean; prev boolean; founding boolean;
begin
  select joined_at into j from shoebox.accounts where user_id = p_user;
  select exists (select 1 from shoebox.passes where user_id = p_user and status = 'paid' and tax_year < p_year) into any_paid;
  select exists (select 1 from shoebox.passes where user_id = p_user and status = 'paid' and tax_year = p_year - 1) into prev;
  founding := j < '2027-01-01T00:00:00Z' and (not any_paid or prev);
  return jsonb_build_object('amount', case when founding then 3900 else 5900 end, 'founding', founding);
end $$;
revoke all on function shoebox.pass_price(text, int) from public, anon, authenticated;

-- App: what this account owns and what the next pass would cost.
create or replace function public.shoebox_passes(p_token text, p_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  return jsonb_build_object(
    'passes', coalesce((select jsonb_agg(jsonb_build_object('tax_year', tax_year, 'status', status, 'amount', amount, 'founding', founding, 'at', shoebox.ms(created_at)) order by tax_year desc)
                        from shoebox.passes where user_id = s.user_id), '[]'::jsonb),
    'quote', shoebox.pass_price(s.user_id, p_year));
end $$;
revoke all on function public.shoebox_passes(text, int) from public;
grant execute on function public.shoebox_passes(text, int) to anon, authenticated;

-- Server only (Edge Functions with the service role) ------------------------

-- Checkout: who's buying, their email for the Stripe receipt, the price, and
-- whether they already own this year.
create or replace function public.shoebox_srv_checkout_info(p_token text, p_year int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  return (select jsonb_build_object('user_id', a.user_id, 'email', a.email,
            'owned', exists (select 1 from shoebox.passes p where p.user_id = a.user_id and p.tax_year = p_year and p.status = 'paid'))
          || shoebox.pass_price(a.user_id, p_year)
          from shoebox.accounts a where a.user_id = s.user_id);
end $$;

create or replace function public.shoebox_srv_record_pass(p_user text, p_year int, p_amount int, p_currency text, p_founding boolean, p_session text, p_intent text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from shoebox.accounts where user_id = p_user) then return; end if; -- account deleted since checkout
  insert into shoebox.passes (user_id, tax_year, amount, currency, founding, stripe_session, payment_intent, status)
  values (p_user, p_year, p_amount, coalesce(p_currency, 'usd'), p_founding, p_session, p_intent, 'paid')
  on conflict (user_id, tax_year) do update set amount = excluded.amount, founding = excluded.founding, stripe_session = excluded.stripe_session,
    payment_intent = excluded.payment_intent, status = 'paid', created_at = now();
end $$;

create or replace function public.shoebox_srv_refund_pass(p_intent text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update shoebox.passes set status = 'refunded' where payment_intent = p_intent;
end $$;

revoke all on function public.shoebox_srv_checkout_info(text, int), public.shoebox_srv_record_pass(text, int, int, text, boolean, text, text),
  public.shoebox_srv_refund_pass(text) from public, anon, authenticated;
grant execute on function public.shoebox_srv_checkout_info(text, int), public.shoebox_srv_record_pass(text, int, int, text, boolean, text, text),
  public.shoebox_srv_refund_pass(text) to service_role;
