-- Run AFTER migrations, in a disposable/local Supabase database. Rolls back all fixtures.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
-- Seed as the trusted test role; ordinary hosts cannot create more games after migration 002.
select public.d20_create_session('20000000-0000-4000-8000-000000000001','Test',repeat('a',64),
  (select jsonb_agg(jsonb_build_object('slot',i,'displayName','Ingredient '||i,'defaultMl',10,'abv',0) order by i) from generate_series(1,20) i));
set local role authenticated;
do $
declare config jsonb; state jsonb; snapshot jsonb;
begin
  select jsonb_agg(jsonb_build_object('slot',i,'displayName','Ingredient '||i,'defaultMl',10,'abv',0) order by i) into config from generate_series(1,20) i;
  state := public.d20_host_state('20000000-0000-4000-8000-000000000001');
  assert state->>'revision'='0';
  snapshot := jsonb_build_object('id','drink-1','createdAt','2026-11-08T00:00:00Z','bartenderTitle','Test drink','bartenderSummary','Test',
    'rolledIngredients',jsonb_build_array(1,2,3),'finalIngredients',jsonb_build_array(jsonb_build_object('slot',1,'displayName','One','finalMl',10),jsonb_build_object('slot',2,'displayName','Two','finalMl',10),jsonb_build_object('slot',3,'displayName','Three','finalMl',10)),
    'totalVolumeMl',30,'pureAlcoholMl',0,'estimatedAbv',0,'generatorAdditions','[]'::jsonb,'preparationSteps','[]'::jsonb,'warnings','[]'::jsonb,'generatorNotes','[]'::jsonb);
  state := public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'encounter',snapshot);
  assert state->>'revision'='1';
  assert state->'currentEncounter'->'snapshot'=snapshot;
  assert state->'currentEncounter'->>'servings'='2';
  state := public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'encounter',snapshot);
  assert state->>'revision'='1', 'duplicate changed revision';
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',0,'clear','{}');
    raise exception 'stale revision accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',1,'config','[]');
    raise exception 'invalid config accepted';
  exception when check_violation then null; end;
  state := public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',1,'player','{"id":"40000000-0000-4000-8000-000000000001","name":"Ryan"}');
  assert state->'players'->0->>'name'='Ryan';
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000005',2,'encounter',snapshot || '{"totalVolumeMl":151}'::jsonb);
    raise exception 'invalid snapshot accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000006',2,'encounter',snapshot || '{"bartenderTitle":"changed"}'::jsonb);
    raise exception 'mutable snapshot accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform * from public.d20_sessions;
    raise exception 'host can read raw tables';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  begin
    perform public.d20_host_state('20000000-0000-4000-8000-000000000001');
    raise exception 'other host can read session';
  exception when insufficient_privilege then null; end;
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000007',2,'clear','{}');
    raise exception 'other host can mutate session';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
do $$ declare state jsonb; begin
  state := public.d20_presentation('20000000-0000-4000-8000-000000000001',repeat('a',64));
  assert state->'currentEncounter'->>'id'='drink-1';
  assert not state ? 'owner_id' and not state ? 'players' and not state ? 'config' and not state ? 'view_token_hash';
  begin
    perform public.d20_presentation('20000000-0000-4000-8000-000000000001',repeat('b',64));
    raise exception 'wrong view token accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.d20_encounters;
    raise exception 'display can enumerate encounters';
  exception when insufficient_privilege then null; end;
  begin
    perform public.d20_mutate('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000008',2,'clear','{}');
    raise exception 'display can mutate session';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
