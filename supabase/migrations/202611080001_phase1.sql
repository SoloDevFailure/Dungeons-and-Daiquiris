-- Phase 1: host-owned sessions; narrowly scoped RPCs are the only write path.
begin;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table public.d20_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 100),
  view_token_hash bytea not null,
  ingredient_config jsonb not null,
  current_encounter_id text,
  revision bigint not null default 0,
  created_at timestamptz not null default now()
);
create index on public.d20_sessions(owner_id);
create table public.d20_players (
  session_id uuid not null references public.d20_sessions(id) on delete cascade,
  id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key(session_id,id)
);
create table public.d20_encounters (
  session_id uuid not null references public.d20_sessions(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  snapshot jsonb not null,
  servings integer not null default 2 check (servings = 2),
  created_at timestamptz not null default now(),
  primary key(session_id,id)
);
alter table public.d20_sessions add constraint d20_current_encounter_fk
  foreign key(id,current_encounter_id) references public.d20_encounters(session_id,id);
create table public.d20_operations (
  session_id uuid not null references public.d20_sessions(id) on delete cascade,
  id uuid not null,
  primary key(session_id,id)
);
-- No client can write tables, enumerate sessions, or retrieve display token hashes.
alter table public.d20_sessions enable row level security;
alter table public.d20_players enable row level security;
alter table public.d20_encounters enable row level security;
alter table public.d20_operations enable row level security;
revoke all on public.d20_sessions, public.d20_players, public.d20_encounters, public.d20_operations from public, anon, authenticated;

create function public.d20_valid_config(p_config jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; n integer := 0;
begin
  if jsonb_typeof(p_config) is distinct from 'array' or jsonb_array_length(p_config) <> 20 then return false; end if;
  for item in select value from jsonb_array_elements(p_config) loop
    n := n + 1;
    if jsonb_typeof(item->'slot') is distinct from 'number' or (item->>'slot')::numeric <> n
      or jsonb_typeof(item->'displayName') is distinct from 'string' or length(trim(item->>'displayName')) not between 1 and 100
      or jsonb_typeof(item->'defaultMl') is distinct from 'number' or (item->>'defaultMl')::numeric < 0
      or jsonb_typeof(item->'abv') is distinct from 'number' or (item->>'abv')::numeric not between 0 and 100 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;
alter table public.d20_sessions add constraint d20_config_valid check(public.d20_valid_config(ingredient_config));

create function public.d20_host_state(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions;
begin
  select * into s from public.d20_sessions where id=p_session and owner_id=auth.uid();
  if not found then raise exception 'Session unavailable for this host' using errcode='42501'; end if;
  return jsonb_build_object('id',s.id,'name',s.name,'revision',s.revision,'config',s.ingredient_config,
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.created_at,p.id) from public.d20_players p where p.session_id=s.id),'[]'::jsonb),
    'currentEncounter',(select jsonb_build_object('id',e.id,'snapshot',e.snapshot,'servings',e.servings) from public.d20_encounters e where e.session_id=s.id and e.id=s.current_encounter_id));
end $$;

create function public.d20_create_session(p_id uuid,p_name text,p_view_token text,p_config jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Host sign-in required' using errcode='42501'; end if;
  if p_view_token is null or p_view_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid display token'; end if;
  insert into public.d20_sessions(id,owner_id,name,view_token_hash,ingredient_config)
    values(p_id,auth.uid(),trim(p_name),extensions.digest(p_view_token,'sha256'),p_config)
    on conflict(id) do nothing;
  return public.d20_host_state(p_id); -- Also checks ownership on idempotent retry.
end $$;

create function public.d20_mutate(p_session uuid,p_operation uuid,p_revision bigint,p_kind text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions; snap jsonb; encounter_id text;
begin
  select * into s from public.d20_sessions where id=p_session and owner_id=auth.uid() for update;
  if not found then raise exception 'Session unavailable for this host' using errcode='42501'; end if;
  if exists(select 1 from public.d20_operations where session_id=p_session and id=p_operation) then return public.d20_host_state(p_session); end if;
  if p_revision is distinct from s.revision then raise exception 'Session changed elsewhere. Restore session, review shared data, then retry pending changes.' using errcode='40001'; end if;
  if p_kind='config' then
    update public.d20_sessions set ingredient_config=p_payload where id=p_session;
  elsif p_kind='player' then
    insert into public.d20_players(session_id,id,name) values(p_session,(p_payload->>'id')::uuid,trim(p_payload->>'name'))
      on conflict(session_id,id) do update set name=excluded.name;
  elsif p_kind='encounter' then
    snap := p_payload; encounter_id := snap->>'id';
    if jsonb_typeof(snap) is distinct from 'object' or octet_length(snap::text)>262144
      or jsonb_typeof(snap->'finalIngredients') is distinct from 'array' or jsonb_array_length(snap->'finalIngredients')<>3
      or jsonb_typeof(snap->'rolledIngredients') is distinct from 'array' or jsonb_array_length(snap->'rolledIngredients')<>3
      or jsonb_typeof(snap->'totalVolumeMl') is distinct from 'number' or (snap->>'totalVolumeMl')::numeric not between 0 and 150
      or jsonb_typeof(snap->'pureAlcoholMl') is distinct from 'number'
      or jsonb_typeof(snap->'estimatedAbv') is distinct from 'number'
      or jsonb_typeof(snap->'bartenderTitle') is distinct from 'string'
      or jsonb_typeof(snap->'bartenderSummary') is distinct from 'string'
      or jsonb_typeof(snap->'preparationSteps') is distinct from 'array'
      or jsonb_typeof(snap->'warnings') is distinct from 'array'
      or jsonb_typeof(snap->'generatorAdditions') is distinct from 'array'
      or jsonb_typeof(snap->'generatorNotes') is distinct from 'array'
      or jsonb_typeof(snap->'createdAt') is distinct from 'string'
      then raise exception 'Invalid recipe snapshot'; end if;
    insert into public.d20_encounters(session_id,id,snapshot) values(p_session,encounter_id,snap) on conflict(session_id,id) do nothing;
    if (select snapshot from public.d20_encounters where session_id=p_session and id=encounter_id) is distinct from snap then raise exception 'Encounter snapshots are immutable'; end if;
    update public.d20_sessions set current_encounter_id=encounter_id where id=p_session;
  elsif p_kind='clear' then
    update public.d20_sessions set current_encounter_id=null where id=p_session;
  else raise exception 'Unknown session operation'; end if;
  insert into public.d20_operations(session_id,id) values(p_session,p_operation);
  update public.d20_sessions set revision=revision+1 where id=p_session;
  return public.d20_host_state(p_session);
end $$;

-- A 256-bit bearer capability grants only this projection; never host access.
create function public.d20_presentation(p_session uuid,p_view_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions;
begin
  if p_view_token is null or p_view_token !~ '^[0-9a-f]{64}$' then raise exception 'Display link unavailable' using errcode='42501'; end if;
  select * into s from public.d20_sessions where id=p_session and view_token_hash=extensions.digest(p_view_token,'sha256');
  if not found then raise exception 'Display link unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',s.id,'name',s.name,'revision',s.revision,
    'currentEncounter',(select jsonb_build_object('id',e.id,'snapshot',e.snapshot,'servings',e.servings) from public.d20_encounters e where e.session_id=s.id and e.id=s.current_encounter_id));
end $$;
revoke all on function public.d20_valid_config(jsonb) from public,anon,authenticated;
revoke all on function public.d20_host_state(uuid) from public,anon,authenticated;
revoke all on function public.d20_create_session(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.d20_mutate(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.d20_presentation(uuid,text) from public,anon,authenticated;
grant execute on function public.d20_host_state(uuid),public.d20_create_session(uuid,text,text,jsonb),public.d20_mutate(uuid,uuid,bigint,text,jsonb) to authenticated;
grant execute on function public.d20_presentation(uuid,text) to anon,authenticated;
commit;
