-- Additive lifecycle/results projection. No rows, scores or encounter snapshots are removed.
begin;
create function public.d20_valid_lifecycle(p_old jsonb,p_new jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare old_number integer:=coalesce((p_old->>'gameNumber')::integer,1);
  new_number integer:=coalesce((p_new->>'gameNumber')::integer,1);
  old_start integer:=coalesce((p_old->>'roundStart')::integer,0);
  new_start integer:=coalesce((p_new->>'roundStart')::integer,0);
  old_count integer:=jsonb_array_length(coalesce(p_old->'awards','[]'::jsonb));
  new_count integer:=jsonb_array_length(p_new->'awards');
  old_end text:=p_old->>'finishedAt'; new_end text:=p_new->>'finishedAt';
  archives jsonb:=coalesce(p_old->'archives','[]'::jsonb);
begin
  if p_new ? 'roundStart' and (jsonb_typeof(p_new->'roundStart')<>'number' or (p_new->>'roundStart')::numeric<>new_start) then return false; end if;
  if p_new ? 'gameNumber' and (jsonb_typeof(p_new->'gameNumber')<>'number' or (p_new->>'gameNumber')::numeric<>new_number) then return false; end if;
  if new_number<1 or new_start<0 or new_start>new_count then return false; end if;
  if new_end is not null then
    if jsonb_typeof(p_new->'finishedAt')<>'string' or p_new->'started'<>'true'::jsonb then return false; end if;
    perform new_end::timestamptz;
  end if;
  if old_end is not null and new_end is null then
    -- Explicit New Game archives the old result range; awards themselves remain immutable.
    return new_number=old_number+1 and new_start=old_count and new_count=old_count
      and p_new->'archives'=archives||jsonb_build_array(jsonb_build_object('number',old_number,'start',old_start,'end',old_count,'finishedAt',old_end));
  end if;
  if new_number<>old_number or new_start<>old_start or coalesce(p_new->'archives','[]'::jsonb)<>archives then return false; end if;
  if old_end is not null then return new_end is not distinct from old_end and new_count=old_count; end if;
  if new_end is not null then return new_count=old_count; end if;
  return true;
exception when others then return false;
end $$;
revoke all on function public.d20_valid_lifecycle(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.d20_gameplay_mutate(p_session uuid,p_operation uuid,p_revision bigint,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions; previous jsonb; player jsonb; award jsonb; winner jsonb;
  snap jsonb; raw_points numeric; starting numeric; agreed numeric; old_count integer; new_count integer; n integer;
begin
  select * into s from public.d20_sessions where id=p_session and owner_id=auth.uid() for update;
  if not found then raise exception 'Game unavailable for this host' using errcode='42501'; end if;
  if exists(select 1 from public.d20_gameplay_operations where session_id=p_session and id=p_operation) then
    return public.d20_host_state(p_session);
  end if;
  previous:=s.gameplay;
  if p_revision is distinct from coalesce((previous->>'version')::bigint,0) then
    raise exception 'Contestants or points changed on another host. Local changes are preserved; review before retrying.' using errcode='40001';
  end if;
  if jsonb_typeof(p_state) is distinct from 'object' or octet_length(p_state::text)>2097152
    or p_state->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_state->'version') is distinct from 'number' or (p_state->>'version')::numeric<>p_revision+1
    or jsonb_typeof(p_state->'started') is distinct from 'boolean'
    or jsonb_typeof(p_state->'players') is distinct from 'array' or jsonb_array_length(p_state->'players') not between 1 and 250
    or jsonb_typeof(p_state->'awards') is distinct from 'array' then raise exception 'Invalid gameplay state'; end if;
  if not public.d20_valid_lifecycle(previous,p_state) then raise exception 'Invalid game lifecycle transition; previous results are preserved'; end if;
  if previous->'started'='true'::jsonb and p_state->'started'<>'true'::jsonb then raise exception 'The permanent game cannot be reset'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_state->'players'))<>jsonb_array_length(p_state->'players')
    or (select count(distinct lower(regexp_replace(trim(value->>'name'),'\s+',' ','g'))) from jsonb_array_elements(p_state->'players'))<>jsonb_array_length(p_state->'players') then raise exception 'Duplicate contestant'; end if;
  for player in select value from jsonb_array_elements(p_state->'players') loop
    perform (player->>'id')::uuid;
    if jsonb_typeof(player->'name') is distinct from 'string' or length(trim(player->>'name')) not between 1 and 80
      or jsonb_typeof(player->'enabled') is distinct from 'boolean' then raise exception 'Invalid contestant'; end if;
  end loop;
  -- Disabling preserves identities and all earned points. No historical player is removed.
  if exists(select 1 from jsonb_array_elements(coalesce(previous->'players','[]'::jsonb)) old
    where not exists(select 1 from jsonb_array_elements(p_state->'players') p where p->>'id'=old->>'id')) then raise exception 'Disable contestants instead of removing them'; end if;
  old_count:=jsonb_array_length(coalesce(previous->'awards','[]'::jsonb));new_count:=jsonb_array_length(p_state->'awards');
  if new_count<old_count or new_count>old_count+1 then raise exception 'Append one completed round at a time'; end if;
  if old_count>0 then
    for n in 0..old_count-1 loop
      if previous->'awards'->n is distinct from p_state->'awards'->n then raise exception 'Recorded awards are immutable'; end if;
    end loop;
  end if;
  if new_count>old_count then
    if p_state->>'finishedAt' is not null then raise exception 'The game is finished'; end if;
    if p_state->'started'<>'true'::jsonb then raise exception 'Start the game before awarding points'; end if;
    award:=p_state->'awards'->old_count;
    if exists(select 1 from jsonb_array_elements(coalesce(previous->'awards','[]'::jsonb)) a where a->>'encounterId'=award->>'encounterId') then raise exception 'Drink already awarded'; end if;
    select snapshot into snap from public.d20_encounters where session_id=p_session and id=award->>'encounterId';
    if not found then raise exception 'Upload the saved recipe before awarding points'; end if;
    if (snap->>'totalVolumeMl')::numeric<=0 or snap->'safeToServe'='false'::jsonb or snap->'safety'->>'status'='blocked' then raise exception 'Blocked or empty recipes cannot earn points'; end if;
    raw_points:=20+(snap->>'pureAlcoholMl')::numeric*4;
    raw_points:=raw_points+20*(select count(*) from jsonb_array_elements(snap->'finalIngredients') i where (i->>'finalMl')::numeric>0 and (i->'savoury'='true'::jsonb or i->'tags' ? 'savoury'));
    if exists(select 1 from jsonb_array_elements(snap->'finalIngredients') i where (i->>'finalMl')::numeric>0 and (i->>'heatLevel'='high' or i->'tags' ? 'hot')) then raw_points:=raw_points+30; end if;
    if snap->'compatibilityFlags' ? 'dairy_acid' then raw_points:=raw_points+20; end if;
    starting:=ceil((raw_points-0.00000001)/2)*2;
    if jsonb_typeof(award->'startingPoints') is distinct from 'number' or (award->>'startingPoints')::numeric<>starting
      or jsonb_typeof(award->'agreedPoints') is distinct from 'number' then raise exception 'Invalid points calculation'; end if;
    agreed:=(award->>'agreedPoints')::numeric;
    if agreed<>trunc(agreed) or agreed not between starting/2 and starting*2 then raise exception 'Agreed points outside bidding range'; end if;
    if award->>'title' is distinct from snap->>'bartenderTitle' or jsonb_typeof(award->'createdAt') is distinct from 'string' then raise exception 'Invalid award details'; end if;
    perform (award->>'createdAt')::timestamptz;
    if jsonb_typeof(award->'winners') is distinct from 'array' or jsonb_array_length(award->'winners') not between 1 and 3 then raise exception 'Choose one to three winners'; end if;
    if (select count(distinct w->>'playerId') from jsonb_array_elements(award->'winners') w)<>jsonb_array_length(award->'winners') then raise exception 'Duplicate winner'; end if;
    for winner in select value from jsonb_array_elements(award->'winners') loop
      if not exists(select 1 from jsonb_array_elements(p_state->'players') p where p->>'id'=winner->>'playerId' and p->'enabled'='true'::jsonb and p->>'name'=winner->>'name')
        or jsonb_typeof(winner->'multiplier') is distinct from 'number' or (winner->>'multiplier')::numeric not in (1,0.5)
        or jsonb_typeof(winner->'points') is distinct from 'number' or (winner->>'points')::numeric<>agreed*(winner->>'multiplier')::numeric then raise exception 'Invalid winner or penalty'; end if;
    end loop;
  end if;
  for player in select value from jsonb_array_elements(p_state->'players') loop
    insert into public.d20_players(session_id,id,name) values(p_session,(player->>'id')::uuid,player->>'name')
      on conflict(session_id,id) do update set name=excluded.name;
  end loop;
  update public.d20_sessions set gameplay=p_state where id=p_session;
  insert into public.d20_gameplay_operations(session_id,id) values(p_session,p_operation);
  return public.d20_host_state(p_session);
end $$;

create function public.d20_result_data(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('lastRolledEncounterId',(select id from public.d20_encounters where session_id=p_session order by created_at desc,id desc limit 1),'awardEncounters',coalesce((
    select jsonb_agg(jsonb_build_object('id',e.id,'snapshot',e.snapshot) order by a.ordinality)
    from public.d20_sessions s,
      jsonb_array_elements(coalesce(s.gameplay->'awards','[]'::jsonb)) with ordinality a(value,ordinality)
      join public.d20_encounters e on e.session_id=p_session and e.id=a.value->>'encounterId'
    where s.id=p_session and s.gameplay->>'finishedAt' is not null and a.ordinality>coalesce((s.gameplay->>'roundStart')::integer,0)
  ),'[]'::jsonb));
$$;
revoke all on function public.d20_result_data(uuid) from public,anon,authenticated;
create or replace function public.d20_host_state(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions;
begin
  select * into s from public.d20_sessions where id=p_session and owner_id=auth.uid();
  if not found then raise exception 'Session unavailable for this host' using errcode='42501'; end if;
  return jsonb_build_object('id',s.id,'name',s.name,'revision',s.revision,'config',s.ingredient_config,
    'gameplay',s.gameplay,
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.created_at,p.id) from public.d20_players p where p.session_id=s.id),'[]'::jsonb),
    'currentEncounter',(select jsonb_build_object('id',e.id,'snapshot',e.snapshot,'servings',e.servings) from public.d20_encounters e where e.session_id=s.id and e.id=s.current_encounter_id)) || public.d20_result_data(s.id);
end $$;
create or replace function public.d20_presentation(p_session uuid,p_view_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.d20_sessions;
begin
  if p_view_token is null or p_view_token !~ '^[0-9a-f]{64}$' then raise exception 'Display link unavailable' using errcode='42501'; end if;
  select * into s from public.d20_sessions where id=p_session and view_token_hash=extensions.digest(p_view_token,'sha256');
  if not found then raise exception 'Display link unavailable' using errcode='42501'; end if;
  return jsonb_build_object('id',s.id,'name',s.name,'revision',s.revision,'gameplay',s.gameplay,
    'currentEncounter',(select jsonb_build_object('id',e.id,'snapshot',e.snapshot,'servings',e.servings) from public.d20_encounters e where e.session_id=s.id and e.id=s.current_encounter_id)) || public.d20_result_data(s.id);
end $$;
-- Existing RPC grants remain unchanged. Helper projections have no client grants.
commit;
