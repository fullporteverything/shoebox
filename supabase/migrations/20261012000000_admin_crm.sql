-- Admin access for the Foreman CRM. An admin is an ordinary Shoebox account
-- listed in shoebox.admins: the CRM signs in with the same email, password and
-- two-factor code as the app (same lockouts, same wipe limit), and every
-- admin function below checks the session belongs to an admin.
--
-- What an admin can see is account metadata the server already keeps: email,
-- join date, devices, lockout counters, how many records of each kind (never
-- their contents, which are encrypted with keys the server doesn't have),
-- passes, reviews and savings figures. Admins can approve or reject reviews
-- and keep internal support notes on an account.

create table if not exists shoebox.admins (
  user_id text primary key references shoebox.accounts(user_id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists shoebox.crm_notes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  author text references shoebox.accounts(user_id) on delete set null,
  kind text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting', 'task')),
  body text not null check (char_length(body) between 1 and 2000),
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_notes_user on shoebox.crm_notes (user_id, created_at desc);

alter table shoebox.admins enable row level security;
alter table shoebox.crm_notes enable row level security;
revoke all on shoebox.admins, shoebox.crm_notes from public, anon, authenticated;

create or replace function shoebox.admin_resolve(p_token text) returns shoebox.sessions
language plpgsql set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  if not exists (select 1 from shoebox.admins where user_id = s.user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  return s;
end $$;

create or replace function public.shoebox_admin_me(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.admin_resolve(p_token);
  return (select jsonb_build_object('user_id', a.user_id, 'email', a.email) from shoebox.accounts a where a.user_id = s.user_id);
end $$;

-- Everything the CRM shows, in one call. Times are milliseconds since 1970.
create or replace function public.shoebox_admin_snapshot(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; cutoff constant timestamptz := '2027-01-01T00:00:00Z';
begin
  s := shoebox.admin_resolve(p_token);
  return jsonb_build_object(
    'now', shoebox.ms(now()),
    'founding_closes', shoebox.ms(cutoff),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', a.user_id,
        'email', a.email,
        'created_at', a.created_at,
        'joined_at', shoebox.ms(a.joined_at),
        'founding_no', case when a.joined_at < cutoff then (select count(*) from shoebox.accounts b where b.joined_at <= a.joined_at) end,
        'shredded', a.wrapped is null,
        'incident', case when a.wrapped is null then a.incident end,
        'two_factor', a.totp_secret is not null,
        'locked_until', case when a.lock_until > now() then shoebox.ms(a.lock_until) end,
        'failed', a.failed,
        'code_failed', a.code_failed,
        'admin', exists (select 1 from shoebox.admins ad where ad.user_id = a.user_id),
        'records', coalesce((select jsonb_object_agg(k.kind, k.n) from (
            select r.kind, count(*) n from shoebox.records r where r.user_id = a.user_id and r.kind not in ('canary', 'log') group by r.kind) k), '{}'::jsonb),
        'devices', coalesce((select jsonb_agg(jsonb_build_object('label', d.label, 'tz', d.tz, 'created_at', shoebox.ms(d.created_at),
            'last_seen', shoebox.ms(d.last_seen), 'revoked', d.revoked_at is not null) order by d.last_seen desc)
            from shoebox.devices d where d.user_id = a.user_id), '[]'::jsonb),
        'last_seen', (select shoebox.ms(max(d.last_seen)) from shoebox.devices d where d.user_id = a.user_id),
        'passes', coalesce((select jsonb_agg(jsonb_build_object('tax_year', p.tax_year, 'amount', p.amount, 'status', p.status,
            'founding', p.founding, 'at', shoebox.ms(p.created_at)) order by p.created_at)
            from shoebox.passes p where p.user_id = a.user_id), '[]'::jsonb),
        'savings', coalesce((select jsonb_agg(jsonb_build_object('tax_year', sr.tax_year, 'amount', sr.amount, 'at', shoebox.ms(sr.updated_at)))
            from shoebox.savings_reports sr where sr.user_id = a.user_id), '[]'::jsonb)
      ) order by a.joined_at desc)
      from shoebox.accounts a), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', r.user_id, 'email', a.email, 'rating', r.rating, 'body', r.body,
        'display_name', r.display_name, 'role', r.role, 'status', r.status,
        'created_at', shoebox.ms(r.created_at), 'updated_at', shoebox.ms(r.updated_at)) order by r.updated_at desc)
      from shoebox.reviews r join shoebox.accounts a on a.user_id = r.user_id), '[]'::jsonb),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'user_id', n.user_id, 'author', au.email, 'kind', n.kind, 'body', n.body,
        'due_at', shoebox.ms(n.due_at), 'done', n.done, 'created_at', shoebox.ms(n.created_at)) order by n.created_at desc)
      from shoebox.crm_notes n left join shoebox.accounts au on au.user_id = n.author), '[]'::jsonb)
  );
end $$;

create or replace function public.shoebox_admin_set_review(p_token text, p_user text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.admin_resolve(p_token);
  if p_status not in ('pending', 'approved', 'rejected') then return '{"error": "invalid"}'::jsonb; end if;
  update shoebox.reviews set status = p_status, updated_at = now() where user_id = p_user;
  if not found then return '{"error": "not_found"}'::jsonb; end if;
  return jsonb_build_object('status', p_status);
end $$;

create or replace function public.shoebox_admin_add_note(p_token text, p_user text, p_kind text, p_body text, p_due bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; nid uuid;
begin
  s := shoebox.admin_resolve(p_token);
  if coalesce(p_kind, '') not in ('note', 'call', 'email', 'meeting', 'task') or char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then
    return '{"error": "invalid"}'::jsonb;
  end if;
  if not exists (select 1 from shoebox.accounts where user_id = p_user) then return '{"error": "not_found"}'::jsonb; end if;
  insert into shoebox.crm_notes (user_id, author, kind, body, due_at)
    values (p_user, s.user_id, p_kind, trim(p_body), case when p_due is not null then to_timestamp(p_due / 1000.0) end)
    returning id into nid;
  return jsonb_build_object('id', nid);
end $$;

create or replace function public.shoebox_admin_set_note(p_token text, p_id uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.admin_resolve(p_token);
  update shoebox.crm_notes set done = p_done where id = p_id;
  if not found then return '{"error": "not_found"}'::jsonb; end if;
  return jsonb_build_object('done', p_done);
end $$;

revoke all on function public.shoebox_admin_me(text), public.shoebox_admin_snapshot(text),
  public.shoebox_admin_set_review(text, text, text), public.shoebox_admin_add_note(text, text, text, text, bigint),
  public.shoebox_admin_set_note(text, uuid, boolean), shoebox.admin_resolve(text) from public;
grant execute on function public.shoebox_admin_me(text), public.shoebox_admin_snapshot(text),
  public.shoebox_admin_set_review(text, text, text), public.shoebox_admin_add_note(text, text, text, text, bigint),
  public.shoebox_admin_set_note(text, uuid, boolean) to anon, authenticated;
