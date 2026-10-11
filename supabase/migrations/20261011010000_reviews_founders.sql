-- Reviews and the founding-member program.
--
-- Reviews: one per account, written by signed-in users only. New and edited
-- reviews wait as "pending" until the owner approves them in the dashboard
-- (Table Editor -> shoebox.reviews -> status). Approve or reject on content
-- (spam, abuse, personal data), never on star rating: hiding negative reviews
-- is prohibited by the FTC's rule on consumer reviews (16 CFR 465).
--
-- Founding members: every account that joined before 2027-01-01 (server time).

alter table shoebox.accounts add column if not exists joined_at timestamptz not null default now();

create table if not exists shoebox.reviews (
  user_id text primary key references shoebox.accounts(user_id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 20 and 600),
  display_name text not null check (char_length(display_name) between 1 and 40),
  role text not null default '' check (char_length(role) <= 40),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table shoebox.reviews enable row level security;
revoke all on shoebox.reviews from public, anon, authenticated;

create or replace function public.shoebox_submit_review(p_token text, p_rating int, p_body text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  if p_rating not between 1 and 5 or char_length(trim(coalesce(p_body, ''))) not between 20 and 600
     or char_length(trim(coalesce(p_name, ''))) not between 1 and 40 or char_length(coalesce(p_role, '')) > 40 then
    return '{"error": "invalid"}'::jsonb;
  end if;
  insert into shoebox.reviews (user_id, rating, body, display_name, role)
  values (s.user_id, p_rating, trim(p_body), trim(p_name), trim(coalesce(p_role, '')))
  on conflict (user_id) do update set rating = excluded.rating, body = excluded.body, display_name = excluded.display_name,
    role = excluded.role, status = 'pending', updated_at = now();
  return '{"status": "pending"}'::jsonb;
end $$;

create or replace function public.shoebox_my_review(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  return (select jsonb_build_object('rating', rating, 'body', body, 'display_name', display_name, 'role', role, 'status', status)
          from shoebox.reviews where user_id = s.user_id);
end $$;

-- Every approved review, newest first, with the average over all of them.
create or replace function public.shoebox_reviews() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'count', count(*),
    'average', round(avg(rating)::numeric, 1),
    'reviews', coalesce(jsonb_agg(jsonb_build_object('rating', rating, 'body', body, 'name', display_name, 'role', role,
                 'month', to_char(created_at, 'Mon YYYY')) order by created_at desc), '[]'::jsonb))
  from (select * from shoebox.reviews where status = 'approved' order by created_at desc limit 60) r
$$;

create or replace function public.shoebox_membership(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; j timestamptz; cutoff constant timestamptz := '2027-01-01T00:00:00Z';
begin
  s := shoebox.resolve(p_token);
  select joined_at into j from shoebox.accounts where user_id = s.user_id;
  return jsonb_build_object(
    'joined_at', shoebox.ms(j),
    'founding', j < cutoff,
    'number', case when j < cutoff then (select count(*) from shoebox.accounts where joined_at <= j) end,
    'closes_at', shoebox.ms(cutoff));
end $$;

revoke all on function public.shoebox_submit_review(text, int, text, text, text), public.shoebox_my_review(text),
  public.shoebox_reviews(), public.shoebox_membership(text) from public;
grant execute on function public.shoebox_submit_review(text, int, text, text, text), public.shoebox_my_review(text),
  public.shoebox_reviews(), public.shoebox_membership(text) to anon, authenticated;
