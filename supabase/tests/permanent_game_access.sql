-- Run in a disposable/local database AFTER both migrations. Rolls back fixtures.
begin;
insert into auth.users(id) values ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
-- Only the trusted migration/test role can create a legacy fixture now.
select public.d20_create_session('20000000-0000-4000-8000-000000000001','Existing event',repeat('a',64),
  (select jsonb_agg(jsonb_build_object('slot',i,'displayName','Ingredient '||i,'defaultMl',10,'abv',0) order by i) from generate_series(1,20) i));
insert into public.d20_permanent_game(singleton,session_id,view_token)
  values(true,'20000000-0000-4000-8000-000000000001',null)
  on conflict(singleton) do update set session_id=excluded.session_id,view_token=null;
set local role authenticated;
do $$ declare first jsonb; restored jsonb; begin
  first := public.d20_connect_game('20000000-0000-4000-8000-000000000001',repeat('a',64));
  assert first->>'id'='20000000-0000-4000-8000-000000000001';
  assert first->>'viewToken'=repeat('a',64) and (first->>'permanent')::boolean;
  restored := public.d20_connect_game(null,null);
  assert restored=first, 'restoration must return the same game and pairing';
  begin
    perform public.d20_create_session('20000000-0000-4000-8000-000000000002','Forbidden',repeat('b',64),'[]');
    raise exception 'host can still create another game';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.d20_permanent_game;
    raise exception 'host can read raw pairing table';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$ begin
  begin
    perform public.d20_connect_game(null,null);
    raise exception 'another identity recovered host data';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.d20_connect_game(null,null);
    raise exception 'read-only viewer recovered host data';
  exception when insufficient_privilege then null; end;
  assert public.d20_presentation('20000000-0000-4000-8000-000000000001',repeat('a',64))->'currentEncounter'='null'::jsonb;
end $$;
reset role;
rollback;
