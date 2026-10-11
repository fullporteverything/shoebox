-- Part 2 of 2. Paste into Supabase -> SQL Editor -> Run.
-- If Supabase warns about a "destructive operation", click "Run this query":
-- the DELETEs are inside functions (signing devices out, wiping on a breach)
-- and nothing is deleted when you run this. Safe to run twice.

create or replace function public.shoebox_login(p_email text, p_auth text, p_device jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
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

create or replace function public.shoebox_login_2fa(p_ticket text, p_code text, p_recovery boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
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

create or replace function public.shoebox_commit(p_token text, p_base bigint, p_puts jsonb, p_dels text[], p_index_mac text) returns jsonb language plpgsql security definer set search_path = '' as $$
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

create or replace function public.shoebox_change_password(p_token text, p_old_auth text, p_salt text, p_iterations int, p_wrapped jsonb, p_new_auth text) returns jsonb language plpgsql security definer set search_path = '' as $$
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

create or replace function public.shoebox_delete(p_token text) returns void language plpgsql security definer set search_path = '' as $$
declare s shoebox.sessions;
begin
  s := shoebox.resolve(p_token);
  delete from shoebox.accounts where user_id = s.user_id;
end $$;

create or replace function public.shoebox_sign_out(p_token text, p_device uuid, p_others boolean) returns jsonb language plpgsql security definer set search_path = '' as $$
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
