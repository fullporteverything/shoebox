-- Site-wide "tax saved" counter. Opt-in: a user who agrees reports one
-- rounded number per tax year (what their receipts took off their own
-- estimate). Nothing else about their vault reaches the server. Opting out
-- sets the figure to zero. Amounts are capped to keep a bad client from
-- inflating the total.

create table if not exists shoebox.savings_reports (
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  tax_year int not null check (tax_year between 2020 and 2100),
  amount int not null check (amount between 0 and 250000),
  updated_at timestamptz not null default now(),
  primary key (user_id, tax_year)
);
alter table shoebox.savings_reports enable row level security;
revoke all on shoebox.savings_reports from public, anon, authenticated;

create or replace function public.shoebox_report_savings(p_token text, p_year int, p_amount int) returns void
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  insert into shoebox.savings_reports (user_id, tax_year, amount)
  values (s.user_id, p_year, greatest(0, least(250000, (round(coalesce(p_amount, 0) / 10.0) * 10)::int)))
  on conflict (user_id, tax_year) do update set amount = excluded.amount, updated_at = now();
end $$;

create or replace function public.shoebox_savings_total() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('total', coalesce(sum(r.amount), 0), 'people', count(distinct r.user_id))
  from shoebox.savings_reports r join shoebox.accounts a on a.user_id = r.user_id
  where r.amount > 0 and a.wrapped is not null
$$;

revoke all on function public.shoebox_report_savings(text, int, int), public.shoebox_savings_total() from public;
grant execute on function public.shoebox_report_savings(text, int, int), public.shoebox_savings_total() to anon, authenticated;
