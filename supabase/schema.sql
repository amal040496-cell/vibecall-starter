-- VibeCall starter schema. Run the entire file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.vc_waiting (
  session_id uuid primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.vc_matches (
  room_id uuid primary key default gen_random_uuid(),
  user_a uuid not null,
  user_b uuid not null,
  created_at timestamptz not null default now(),
  constraint different_users check (user_a <> user_b)
);
create unique index if not exists vc_match_user_a on public.vc_matches(user_a);
create unique index if not exists vc_match_user_b on public.vc_matches(user_b);

create table if not exists public.vc_reports (
  id bigint generated always as identity primary key,
  reporter_session uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.vc_waiting enable row level security;
alter table public.vc_matches enable row level security;
alter table public.vc_reports enable row level security;

revoke all on public.vc_waiting, public.vc_matches, public.vc_reports from anon, authenticated;
grant usage on schema public to anon, authenticated;

create or replace function public.find_match(p_session_id uuid)
returns table(room_id uuid, peer_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  candidate uuid;
  new_room uuid;
begin
  if p_session_id is null then raise exception 'session required'; end if;
  perform pg_advisory_xact_lock(hashtext('vibecall_matchmaking'));

  -- Return an existing match if this tab already has one.
  return query
    select m.room_id,
      case when m.user_a = p_session_id then m.user_b else m.user_a end
    from vc_matches m
    where m.user_a = p_session_id or m.user_b = p_session_id;
  if found then return; end if;

  -- Remove abandoned queue entries and this session's stale queue row.
  delete from vc_waiting where created_at < now() - interval '3 minutes';
  delete from vc_waiting where session_id = p_session_id;

  select w.session_id into candidate
  from vc_waiting w
  where w.session_id <> p_session_id
  order by w.created_at
  limit 1
  for update skip locked;

  if candidate is null then
    insert into vc_waiting(session_id) values (p_session_id)
    on conflict (session_id) do update set created_at = now();
    return;
  end if;

  delete from vc_waiting where session_id = candidate;
  new_room := gen_random_uuid();
  insert into vc_matches(room_id, user_a, user_b)
  values (new_room, p_session_id, candidate);
  return query select new_room, candidate;
end;
$$;

create or replace function public.get_my_match(p_session_id uuid)
returns table(room_id uuid, peer_id uuid)
language sql security definer set search_path = public
as $$
  select m.room_id,
    case when m.user_a = p_session_id then m.user_b else m.user_a end
  from vc_matches m
  where m.user_a = p_session_id or m.user_b = p_session_id
  limit 1;
$$;

create or replace function public.leave_chat(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from vc_waiting where session_id = p_session_id;
  delete from vc_matches where user_a = p_session_id or user_b = p_session_id;
end;
$$;

create or replace function public.submit_report(p_session_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_session_id is null or p_reason is null or char_length(trim(p_reason)) < 1 then
    raise exception 'report details required';
  end if;
  insert into vc_reports(reporter_session, reason)
  values (p_session_id, left(trim(p_reason), 500));
end;
$$;

revoke all on function public.find_match(uuid) from public;
revoke all on function public.get_my_match(uuid) from public;
revoke all on function public.leave_chat(uuid) from public;
revoke all on function public.submit_report(uuid, text) from public;
grant execute on function public.find_match(uuid) to anon, authenticated;
grant execute on function public.get_my_match(uuid) to anon, authenticated;
grant execute on function public.leave_chat(uuid) to anon, authenticated;
grant execute on function public.submit_report(uuid, text) to anon, authenticated;
