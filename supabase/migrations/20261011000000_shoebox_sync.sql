-- Shoebox cloud sync. The server keeps the same ciphertext the browser keeps,
-- so a vault opens on any device, and it enforces lockouts where a browser
-- can't. It never sees a password, a data key or a decrypted record.
--
-- Everything lives in the private "shoebox" schema, which the API does not
-- expose. The only way in is the public.shoebox_* functions below, each of
-- which checks a session token (or, for sign-in, a password-derived proof).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists shoebox;
revoke all on schema shoebox from public, anon, authenticated;

create table shoebox.accounts (
  user_id text primary key,
  email text not null unique,
  created_at bigint not null,
  salt text not null,
  iterations int not null,
  wrapped jsonb,                         -- data key wrapped by the password key; null once shredded
  auth_hash text,                        -- sha256 of a key derived from the password (never the password)
  index_mac text not null default '',    -- HMAC over every record, signed with a key only the browser holds
  rev bigint not null default 1,
  failed int not null default 0,         -- every failed sign-in step; drives the lockout
  code_failed int not null default 0,    -- wrong two-factor codes after a correct password; drives the wipe
  lock_until timestamptz,
  policy jsonb not null,
  terms jsonb not null,
  incident jsonb,
  totp_secret text,                      -- only while two-factor is on, so the server can refuse to release the vault without a code
  totp_last_step bigint not null default 0,
  recovery text[] not null default '{}', -- sha256 of each unused recovery code
  updated_at timestamptz not null default now()
);

create table shoebox.records (
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  id text not null,
  kind text not null,
  sealed jsonb not null,
  h text not null,
  rev bigint not null,
  primary key (user_id, id)
);
create index on shoebox.records (user_id, rev);

create table shoebox.devices (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  label text not null,
  ua text not null,
  tz text not null,
  created_at timestamptz not null default now(),
  last_sign_in timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  revoked_at timestamptz
);
create index on shoebox.devices (user_id);

create table shoebox.sessions (
  token_hash text primary key,
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  device_id uuid not null references shoebox.devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index on shoebox.sessions (user_id);
create index on shoebox.sessions (device_id);

-- Password was right, a two-factor code is still owed.
create table shoebox.tickets (
  hash text primary key,
  user_id text not null references shoebox.accounts(user_id) on delete cascade,
  device jsonb not null,
  expires_at timestamptz not null
);

alter table shoebox.accounts enable row level security;
alter table shoebox.records enable row level security;
alter table shoebox.devices enable row level security;
alter table shoebox.sessions enable row level security;
alter table shoebox.tickets enable row level security;
revoke all on all tables in schema shoebox from public, anon, authenticated;

-- Helpers (not callable from the API) --------------------------------------

create function shoebox.h(t text) returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(coalesce(t, ''), 'UTF8'), 'sha256'), 'base64')
$$;

create function shoebox.ms(t timestamptz) returns bigint language sql immutable set search_path = '' as $$
  select (extract(epoch from t) * 1000)::bigint
$$;

create function shoebox.b32(p text) returns bytea language plpgsql immutable set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s text := upper(regexp_replace(coalesce(p, ''), '[^A-Za-z2-7]', '', 'g'));
  bits int := 0; val int := 0; out bytea := ''::bytea;
begin
  for i in 1..length(s) loop
    val := ((val << 5) | (position(substr(s, i, 1) in alphabet) - 1)) & 65535;
    bits := bits + 5;
    if bits >= 8 then
      out := out || set_byte('\x00'::bytea, 0, (val >> (bits - 8)) & 255);
      bits := bits - 8;
    end if;
  end loop;
  return out;
end $$;

create function shoebox.hotp(k bytea, counter bigint) returns text language plpgsql immutable set search_path = '' as $$
declare m bytea; o int; bin bigint;
begin
  m := extensions.hmac(int8send(counter), k, 'sha1');
  o := get_byte(m, 19) & 15;
  bin := ((get_byte(m, o) & 127)::bigint << 24) | (get_byte(m, o + 1)::bigint << 16) | (get_byte(m, o + 2)::bigint << 8) | get_byte(m, o + 3);
  return lpad((bin % 1000000)::text, 6, '0');
end $$;

-- RFC 6238 with one step of drift either way. Returns the matching step, or null.
create function shoebox.totp(secret text, code text, last_step bigint) returns bigint language plpgsql set search_path = '' as $$
declare k bytea; st bigint; s bigint;
begin
  if secret is null or code !~ '^\d{6}$' then return null; end if;
  k := shoebox.b32(secret);
  st := floor(extract(epoch from clock_timestamp()) / 30);
  foreach s in array array[st, st - 1, st + 1] loop
    if s > last_step and shoebox.hotp(k, s) = code then return s; end if;
  end loop;
  return null;
end $$;

create function shoebox.vault_json(p_user text) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'user_id', a.user_id, 'email', a.email, 'created_at', a.created_at, 'salt', a.salt, 'iterations', a.iterations,
    'wrapped', a.wrapped, 'index_mac', a.index_mac, 'rev', a.rev, 'policy', a.policy, 'terms', a.terms,
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'sealed', r.sealed, 'h', r.h)) from shoebox.records r where r.user_id = a.user_id), '[]'::jsonb))
  from shoebox.accounts a where a.user_id = p_user
$$;

create function shoebox.resolve(p_token text) returns shoebox.sessions language plpgsql set search_path = '' as $$
declare s shoebox.sessions;
begin
  select * into s from shoebox.sessions where token_hash = shoebox.h(p_token) and last_used > now() - interval '12 hours';
  if not found then raise exception 'session_ended' using errcode = 'P0001'; end if;
  update shoebox.sessions set last_used = now() where token_hash = s.token_hash;
  update shoebox.devices set last_seen = now() where id = s.device_id;
  return s;
end $$;

create function shoebox.grant_session(p_user text, p_device jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare d uuid; tok text := encode(extensions.gen_random_bytes(32), 'base64'); is_new boolean := false;
  v_label text := left(coalesce(nullif(p_device->>'label', ''), 'Unknown device'), 80);
  v_ua text := left(coalesce(p_device->>'ua', ''), 400);
  v_tz text := left(coalesce(p_device->>'tz', ''), 64);
begin
  if coalesce(p_device->>'id', '') ~ '^[0-9a-f-]{36}$' then
    update shoebox.devices set label = v_label, ua = v_ua, tz = v_tz, last_sign_in = now(), last_seen = now()
      where id = (p_device->>'id')::uuid and user_id = p_user and revoked_at is null
      returning id into d;
  end if;
  if d is null then
    insert into shoebox.devices (user_id, label, ua, tz) values (p_user, v_label, v_ua, v_tz) returning id into d;
    is_new := true;
  end if;
  delete from shoebox.sessions where user_id = p_user and last_used < now() - interval '12 hours';
  insert into shoebox.sessions (token_hash, user_id, device_id) values (shoebox.h(tok), p_user, d);
  update shoebox.accounts set failed = 0, code_failed = 0, lock_until = null where user_id = p_user;
  return jsonb_build_object('token', tok, 'device_id', d, 'new_device', is_new);
end $$;

create function shoebox.shred_account(p_user text, p_incident jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare destroyed jsonb; inc jsonb;
begin
  select jsonb_build_array('Encryption key') || coalesce(jsonb_agg(format('%s %s%s', n, lbl, case when n > 1 then 's' else '' end)), '[]'::jsonb)
    into destroyed
    from (select count(*) n, case kind when 'receipt' then 'receipt' when 'income' then 'income record' when 'trip' then 'trip log'
            when 'log' then 'security log' when 'profile' then 'profile' when 'security' then 'two-factor key' else kind end lbl
          from shoebox.records where user_id = p_user and kind <> 'canary' group by kind) k;
  inc := coalesce(p_incident, '{}'::jsonb) || jsonb_build_object('destroyed', destroyed);
  delete from shoebox.records where user_id = p_user;
  delete from shoebox.sessions where user_id = p_user;
  delete from shoebox.tickets where user_id = p_user;
  update shoebox.accounts set wrapped = null, auth_hash = null, index_mac = '', totp_secret = null, recovery = '{}',
    rev = rev + 1, failed = 0, code_failed = 0, lock_until = null, incident = inc, updated_at = now()
    where user_id = p_user;
  return inc;
end $$;

-- A failed sign-in step. Every failure grows the lockout (30 s after three,
-- doubling, capped at an hour). Only wrong codes after a correct password
-- count toward the wipe limit: a stranger who knows an email address must not
-- be able to destroy someone's records by typing wrong passwords.
create function shoebox.fail(p_user text, p_code boolean) returns jsonb language plpgsql set search_path = '' as $$
declare a shoebox.accounts; w int;
begin
  update shoebox.accounts set failed = failed + 1, code_failed = code_failed + (case when p_code then 1 else 0 end)
    where user_id = p_user returning * into a;
  if a.failed >= 3 then
    update shoebox.accounts set lock_until = now() + make_interval(secs => least(3600, 30 * power(2, least(a.failed - 3, 20))))
      where user_id = p_user returning * into a;
  end if;
  w := coalesce((a.policy->>'wipeAfter')::int, 0);
  if p_code and w > 0 and a.code_failed >= w then
    return jsonb_build_object('error', 'shredded', 'incident', shoebox.shred_account(p_user, jsonb_build_object(
      'at', shoebox.ms(now()), 'sensor', 'Password guessing',
      'detail', format('The right password was used, then %s wrong two-factor codes in a row reached your wipe limit of %s.', a.code_failed, w))));
  end if;
  return jsonb_build_object('error', case when p_code then 'bad_code' else 'bad_password' end,
    'failed', a.failed, 'code_failed', a.code_failed, 'wipe_after', w,
    'until', case when a.lock_until > now() then shoebox.ms(a.lock_until) end);
end $$;

revoke all on all functions in schema shoebox from public, anon, authenticated;

-- API ---------------------------------------------------------------------

create function public.shoebox_prelogin(p_email text) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('exists', true, 'user_id', user_id, 'salt', salt, 'iterations', iterations,
       'shredded', wrapped is null, 'incident', incident) from shoebox.accounts where email = lower(trim(p_email))),
    '{"exists": false}'::jsonb)
$$;

create function public.shoebox_enroll(p jsonb, p_device jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare em text := lower(trim(p->>'email')); ex shoebox.accounts;
begin
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or coalesce(p->>'auth', '') = '' or (p->>'iterations')::int < 600000
     or p->'wrapped' is null or coalesce(p->>'user_id', '') = '' then
    return '{"error": "invalid"}'::jsonb;
  end if;
  select * into ex from shoebox.accounts where email = em for update;
  if found then
    if ex.wrapped is not null then return '{"error": "exists"}'::jsonb; end if;
    delete from shoebox.accounts where user_id = ex.user_id; -- a shredded account's email can be reused
  end if;
  insert into shoebox.accounts (user_id, email, created_at, salt, iterations, wrapped, auth_hash, index_mac, rev, policy, terms,
                                totp_secret, totp_last_step, recovery)
  values (p->>'user_id', em, (p->>'created_at')::bigint, p->>'salt', (p->>'iterations')::int, p->'wrapped', shoebox.h(p->>'auth'),
          coalesce(p->>'index_mac', ''), 1, p->'policy', p->'terms', nullif(p->>'totp_secret', ''), coalesce((p->>'totp_last_step')::bigint, 0),
          coalesce(array(select jsonb_array_elements_text(p->'recovery')), '{}'));
  insert into shoebox.records (user_id, id, kind, sealed, h, rev)
    select p->>'user_id', x.id, x.kind, x.sealed, x.h, 1
    from jsonb_to_recordset(coalesce(p->'records', '[]'::jsonb)) as x(id text, kind text, sealed jsonb, h text);
  return shoebox.grant_session(p->>'user_id', p_device) || '{"rev": 1}'::jsonb;
end $$;

create function public.shoebox_login(p_email text, p_auth text, p_device jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a shoebox.accounts; tk text;
begin
  select * into a from shoebox.accounts where email = lower(trim(p_email)) for update;
  if not found then return '{"error": "no_account"}'::jsonb; end if;
  if a.wrapped is null then return jsonb_build_object('error', 'shredded', 'incident', a.incident); end if;
  if a.lock_until > now() then return jsonb_build_object('error', 'locked', 'until', shoebox.ms(a.lock_until)); end if;
  if a.auth_hash is distinct from shoebox.h(p_auth) then return shoebox.fail(a.user_id, false); end if;
  if a.totp_secret is not null then
    tk := encode(extensions.gen_random_bytes(32), 'base64');
    delete from shoebox.tickets where user_id = a.user_id and expires_at < now();
    insert into shoebox.tickets (hash, user_id, device, expires_at) values (shoebox.h(tk), a.user_id, coalesce(p_device, '{}'::jsonb), now() + interval '10 minutes');
    return jsonb_build_object('two_factor', true, 'ticket', tk);
  end if;
  return shoebox.grant_session(a.user_id, p_device) || jsonb_build_object('vault', shoebox.vault_json(a.user_id));
end $$;

-- p_code is a 6-digit code, or with p_recovery the sha256 of a normalized recovery code.
create function public.shoebox_login_2fa(p_ticket text, p_code text, p_recovery boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare t shoebox.tickets; a shoebox.accounts; st bigint;
begin
  select * into t from shoebox.tickets where hash = shoebox.h(p_ticket) and expires_at > now();
  if not found then return '{"error": "expired"}'::jsonb; end if;
  select * into a from shoebox.accounts where user_id = t.user_id for update;
  if a.wrapped is null then return jsonb_build_object('error', 'shredded', 'incident', a.incident); end if;
  if a.lock_until > now() then return jsonb_build_object('error', 'locked', 'until', shoebox.ms(a.lock_until)); end if;
  if p_recovery then
    if not (p_code = any(a.recovery)) then return shoebox.fail(a.user_id, true); end if;
    update shoebox.accounts set recovery = array_remove(recovery, p_code) where user_id = a.user_id;
  else
    st := shoebox.totp(a.totp_secret, p_code, a.totp_last_step);
    if st is null then return shoebox.fail(a.user_id, true); end if;
    update shoebox.accounts set totp_last_step = st where user_id = a.user_id;
  end if;
  delete from shoebox.tickets where hash = t.hash;
  return shoebox.grant_session(a.user_id, t.device) || jsonb_build_object('vault', shoebox.vault_json(a.user_id), 'step', st);
end $$;

create function public.shoebox_pull(p_token text, p_rev bigint) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; a shoebox.accounts;
begin
  s := shoebox.resolve(p_token);
  select * into a from shoebox.accounts where user_id = s.user_id;
  if a.rev = p_rev then return jsonb_build_object('rev', a.rev, 'policy', a.policy); end if;
  return jsonb_build_object('rev', a.rev, 'policy', a.policy, 'index_mac', a.index_mac,
    'index', coalesce((select jsonb_object_agg(id, h) from shoebox.records where user_id = a.user_id), '{}'::jsonb),
    'changed', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'sealed', sealed, 'h', h))
                         from shoebox.records where user_id = a.user_id and rev > p_rev), '[]'::jsonb));
end $$;

create function public.shoebox_commit(p_token text, p_base bigint, p_puts jsonb, p_dels text[], p_index_mac text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; a shoebox.accounts; nr bigint;
begin
  s := shoebox.resolve(p_token);
  select * into a from shoebox.accounts where user_id = s.user_id for update;
  if a.wrapped is null then return '{"error": "shredded"}'::jsonb; end if;
  if a.rev <> p_base then return jsonb_build_object('error', 'conflict', 'rev', a.rev); end if;
  nr := a.rev + 1;
  if p_dels is not null then delete from shoebox.records where user_id = a.user_id and id = any(p_dels); end if;
  insert into shoebox.records (user_id, id, kind, sealed, h, rev)
    select a.user_id, x.id, x.kind, x.sealed, x.h, nr
    from jsonb_to_recordset(coalesce(p_puts, '[]'::jsonb)) as x(id text, kind text, sealed jsonb, h text)
    on conflict (user_id, id) do update set kind = excluded.kind, sealed = excluded.sealed, h = excluded.h, rev = excluded.rev;
  if (select count(*) from shoebox.records where user_id = a.user_id) > 20000 then
    raise exception 'too_many_records' using errcode = 'P0001';
  end if;
  update shoebox.accounts set rev = nr, index_mac = coalesce(p_index_mac, ''), updated_at = now() where user_id = a.user_id;
  return jsonb_build_object('rev', nr);
end $$;

create function public.shoebox_set_policy(p_token text, p_policy jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  update shoebox.accounts set policy = p_policy, updated_at = now() where user_id = s.user_id;
end $$;

-- The browser checks a current code before it calls this.
create function public.shoebox_set_2fa(p_token text, p_secret text, p_last_step bigint, p_recovery text[]) returns void language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  update shoebox.accounts set totp_secret = nullif(p_secret, ''), totp_last_step = coalesce(p_last_step, 0),
    recovery = coalesce(p_recovery, '{}'), updated_at = now() where user_id = s.user_id;
end $$;

-- Re-wraps the data key under a new password. Signs out every other device.
create function public.shoebox_change_password(p_token text, p_old_auth text, p_salt text, p_iterations int, p_wrapped jsonb, p_new_auth text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; a shoebox.accounts;
begin
  s := shoebox.resolve(p_token);
  select * into a from shoebox.accounts where user_id = s.user_id for update;
  if a.auth_hash is distinct from shoebox.h(p_old_auth) then return '{"error": "bad_password"}'::jsonb; end if;
  if p_iterations < 600000 or p_wrapped is null or coalesce(p_new_auth, '') = '' then return '{"error": "invalid"}'::jsonb; end if;
  update shoebox.accounts set salt = p_salt, iterations = p_iterations, wrapped = p_wrapped, auth_hash = shoebox.h(p_new_auth), updated_at = now()
    where user_id = a.user_id;
  delete from shoebox.sessions where user_id = a.user_id and device_id <> s.device_id;
  return '{}'::jsonb;
end $$;

create function public.shoebox_shred(p_token text, p_incident jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  return shoebox.shred_account(s.user_id, p_incident);
end $$;

create function public.shoebox_delete(p_token text) returns void language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  delete from shoebox.accounts where user_id = s.user_id;
end $$;

create function public.shoebox_devices(p_token text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'label', d.label, 'ua', d.ua, 'tz', d.tz,
      'created_at', shoebox.ms(d.created_at), 'last_sign_in', shoebox.ms(d.last_sign_in), 'last_seen', shoebox.ms(d.last_seen),
      'current', d.id = s.device_id,
      'active', exists (select 1 from shoebox.sessions x where x.device_id = d.id and x.last_used > now() - interval '12 hours'))
      order by d.id = s.device_id desc, d.last_seen desc)
    from shoebox.devices d where d.user_id = s.user_id and d.revoked_at is null), '[]'::jsonb);
end $$;

-- Signs out one device (p_device), every other device (p_others), or this session.
create function public.shoebox_sign_out(p_token text, p_device uuid, p_others boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions; n int;
begin
  s := shoebox.resolve(p_token);
  if p_others then
    update shoebox.devices set revoked_at = now() where user_id = s.user_id and id <> s.device_id and revoked_at is null;
    get diagnostics n = row_count;
    delete from shoebox.sessions where user_id = s.user_id and device_id <> s.device_id;
  elsif p_device is not null then
    update shoebox.devices set revoked_at = now() where user_id = s.user_id and id = p_device and revoked_at is null;
    get diagnostics n = row_count;
    delete from shoebox.sessions where user_id = s.user_id and device_id = p_device;
  else
    delete from shoebox.sessions where token_hash = s.token_hash;
    n := 0;
  end if;
  return jsonb_build_object('signed_out', n);
end $$;

revoke all on function public.shoebox_prelogin(text), public.shoebox_enroll(jsonb, jsonb), public.shoebox_login(text, text, jsonb),
  public.shoebox_login_2fa(text, text, boolean), public.shoebox_pull(text, bigint), public.shoebox_commit(text, bigint, jsonb, text[], text),
  public.shoebox_set_policy(text, jsonb), public.shoebox_set_2fa(text, text, bigint, text[]),
  public.shoebox_change_password(text, text, text, int, jsonb, text), public.shoebox_shred(text, jsonb), public.shoebox_delete(text),
  public.shoebox_devices(text), public.shoebox_sign_out(text, uuid, boolean) from public;
grant execute on function public.shoebox_prelogin(text), public.shoebox_enroll(jsonb, jsonb), public.shoebox_login(text, text, jsonb),
  public.shoebox_login_2fa(text, text, boolean), public.shoebox_pull(text, bigint), public.shoebox_commit(text, bigint, jsonb, text[], text),
  public.shoebox_set_policy(text, jsonb), public.shoebox_set_2fa(text, text, bigint, text[]),
  public.shoebox_change_password(text, text, text, int, jsonb, text), public.shoebox_shred(text, jsonb), public.shoebox_delete(text),
  public.shoebox_devices(text), public.shoebox_sign_out(text, uuid, boolean) to anon, authenticated;
