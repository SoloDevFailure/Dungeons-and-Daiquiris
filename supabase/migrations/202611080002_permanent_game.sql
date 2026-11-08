-- One permanent event, pointing at existing data. No game/encounter is deleted.
begin;
create table public.d20_permanent_game (
  singleton boolean primary key default true check(singleton),
  session_id uuid not null unique references public.d20_sessions(id),
  -- Read capability only; never a host credential. Recoverable by its owner RPC.
  view_token text check(view_token ~ '^[0-9a-f]{64}$')
);
alter table public.d20_permanent_game enable row level security;
revoke all on public.d20_permanent_game from public,anon,authenticated;
-- If unambiguous, bind the only existing game now. Otherwise the original host's
-- saved game selects it on first connection; no arbitrary oldest/latest choice.
insert into public.d20_permanent_game(singleton,session_id)
  select true,id from public.d20_sessions
  where (select count(*) from public.d20_sessions)=1;

create function public.d20_connect_game(p_existing uuid default null,p_view_token text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare game public.d20_permanent_game; state jsonb;
begin
  if auth.uid() is null then raise exception 'Host sign-in required' using errcode='42501'; end if;
  select * into game from public.d20_permanent_game where singleton for update;
  if not found then
    if p_existing is null then raise exception 'Open the original host phone once to attach the existing game. No new game has been created.'; end if;
    -- Check owner and read capability before binding a previously unbound event.
    perform public.d20_host_state(p_existing);
    if p_view_token is null or p_view_token !~ '^[0-9a-f]{64}$' or not exists(
      select 1 from public.d20_sessions where id=p_existing and view_token_hash=extensions.digest(p_view_token,'sha256')
    ) then raise exception 'Original game pairing token required' using errcode='42501'; end if;
    insert into public.d20_permanent_game(singleton,session_id,view_token) values(true,p_existing,p_view_token) on conflict(singleton) do nothing;
    select * into game from public.d20_permanent_game where singleton for update;
  end if;
  -- Host ownership is checked before returning any pairing data.
  state := public.d20_host_state(game.session_id);
  if p_existing is not null and p_existing <> game.session_id then
    raise exception 'This phone has another saved game. Its local data has been preserved; use the original event host.';
  end if;
  if game.view_token is null then
    if p_view_token is null or p_view_token !~ '^[0-9a-f]{64}$' or not exists(
      select 1 from public.d20_sessions where id=game.session_id and view_token_hash=extensions.digest(p_view_token,'sha256')
    ) then raise exception 'Open the original host phone once to recover the existing iPad pairing.' using errcode='42501'; end if;
    update public.d20_permanent_game set view_token=p_view_token where singleton;
    game.view_token := p_view_token;
  end if;
  return state || jsonb_build_object('viewToken',game.view_token,'permanent',true);
end $$;
revoke all on function public.d20_connect_game(uuid,text) from public,anon,authenticated;
grant execute on function public.d20_connect_game(uuid,text) to authenticated;
-- Retain historical rows and the old function, but prevent older clients from
-- creating additional sessions. Owner writes and old iPad links continue working.
revoke execute on function public.d20_create_session(uuid,text,text,jsonb) from authenticated;
commit;
