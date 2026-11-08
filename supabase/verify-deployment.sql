-- Read-only dashboard verification. Run after the migration; every boolean should
-- be true. No fixtures, user records, settings or recipes are changed.
select name, to_regclass('public.'||name) is not null as table_exists,
  coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.'||name)),false) as rls_enabled,
  not has_table_privilege('anon',to_regclass('public.'||name),'SELECT,INSERT,UPDATE,DELETE') as anon_table_denied,
  not has_table_privilege('authenticated',to_regclass('public.'||name),'SELECT,INSERT,UPDATE,DELETE') as host_table_denied
from unnest(array['d20_sessions','d20_players','d20_encounters','d20_operations','d20_permanent_game']) name;
select signature, to_regprocedure(signature) is not null as function_exists,
  coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false)=allow_anon as anon_permission_correct,
  coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)=allow_host as host_permission_correct,
  coalesce((select prosecdef from pg_proc where oid=to_regprocedure(signature)),false) as security_definer,
  coalesce((select proconfig @> array['search_path=""'] from pg_proc where oid=to_regprocedure(signature)),false) as search_path_locked
from (values
 ('public.d20_host_state(uuid)',false,true),
 ('public.d20_connect_game(uuid,text)',false,true),
 ('public.d20_create_session(uuid,text,text,jsonb)',false,false),
 ('public.d20_mutate(uuid,uuid,bigint,text,jsonb)',false,true),
 ('public.d20_presentation(uuid,text)',true,true)
) as required(signature,allow_anon,allow_host);
