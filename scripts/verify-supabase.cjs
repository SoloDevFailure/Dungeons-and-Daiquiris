'use strict';
// Read-only deployment smoke test. No anonymous accounts or game records created.
const assert=require('node:assert/strict');
require('../config.js');require('../services/storage.js');require('../services/supabase.js');
const D=globalThis.D20;
(async()=>{
  const client=D.supabase.createClient(D20_CONFIG);
  const response=await fetch(client.url+'/auth/v1/settings',{headers:{apikey:D20_CONFIG.publishableKey}});
  assert.equal(response.ok,true,'Supabase public configuration must be reachable');
  const settings=await response.json();
  if (Object.hasOwn(settings.external || {}, 'anonymous_users')) assert.equal(settings.external.anonymous_users,true,'Anonymous sign-ins must be enabled');
  console.log('PASS: public project/key and Auth settings endpoint');
  for(const table of ['d20_sessions','d20_players','d20_encounters','d20_operations','d20_permanent_game']){
    const result=await fetch(client.url+`/rest/v1/${table}?select=*&limit=1`,{headers:{apikey:D20_CONFIG.publishableKey}});
    assert.ok([401,403].includes(result.status),`${table} must deny unsigned table access`);
  }
  const id='00000000-0000-4000-8000-000000000000';
  for(const [name,params] of [
    ['d20_connect_game',{p_existing:null,p_view_token:null}],
    ['d20_host_state',{p_session:id}],
    ['d20_create_session',{p_id:id,p_name:'must not create',p_view_token:'b'.repeat(64),p_config:[]}],
    ['d20_presentation',{p_session:id,p_view_token:'b'.repeat(64)}],
  ])await assert.rejects(()=>client.rpc(name,params,false),error=>[401,403].includes(error.status),`${name} must deny this unsigned/invalid-capability request`);
  console.log('PASS: raw-table denial, host RPC denial and invalid read-link denial');
  console.log('Read-only API checks passed. Verify the signed-in original phone and iPad pairing in the app.');
})().catch(error=>{console.error('Live verification failed:',error.message);process.exitCode=1});
