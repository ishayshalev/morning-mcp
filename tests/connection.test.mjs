import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Morning} from '../lib/morning.mjs';
import {mcp,json,errorText,prepareInput,clientId} from './helpers.mjs';

test('Changing saved credentials invalidates previously prepared drafts',async t=>{
  const c=await mcp(t,{configured:false,version:'2026-07-28'}),file=path.join(c.dir,'config.json');
  await fs.writeFile(file,JSON.stringify({id:'test-account',secret:'test-first-secret',environment:'production'}),{mode:0o600});
  const d=json(await c.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};
  await fs.writeFile(file,JSON.stringify({id:'test-account',secret:'test-rotated-secret',environment:'production'}));
  assert.match(errorText(await c.call('execute_draft',args)),/Connection changed/);
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Corrupt saved configuration gives a safe error while operation discovery stays available',async t=>{
  const c=await mcp(t,{configured:false});await fs.writeFile(path.join(c.dir,'config.json'),'{private invalid content');
  assert.match(errorText(await c.call('connection_status')),/configuration/);
  assert.equal(json(await c.call('api_operations')).length,61);assert.equal((await c.requests()).length,0);
});

test('Authentication errors explain the next step without echoing provider text or credentials',async t=>{
  const c=await mcp(t);
  for(const [code,expected] of [['invalid_client',/key ID and secret/],['invalid_grant',/expired, revoked/],['unauthorized_client',/subscription includes API/]]){
    await c.control({authFailure:code});const text=errorText(await c.call('connection_status',{verifyMorning:true}));
    assert.match(text,expected);assert.doesNotMatch(text,/test-key|test-secret|Do not expose/);
  }
  await c.control({badToken:true});assert.match(errorText(await c.call('connection_status',{verifyMorning:true})),/Unexpected Morning authentication response/);
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Parallel reads share one authentication request; revoked tokens are discarded without retrying a write',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let tokenRequests=0,reads=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(new URL(url).pathname.includes('/oauth/token')){tokenRequests++;return Response.json({accessToken:'fictional-token',tokenType:'Bearer',expiresAt:Math.floor(Date.now()/1000)+3600});}
    reads++;return reads===3?new Response(null,{status:401}):Response.json({fictional:true});
  };
  const morning=new Morning({id:'test-key',secret:'test-secret',environment:'production'});
  await Promise.all([morning.getClient(clientId),morning.getDocument(clientId)]);assert.equal(tokenRequests,1);
  await assert.rejects(morning.getClient(clientId),/HTTP 401/);assert.equal(morning.token,'');assert.equal(reads,3);
  await morning.getClient(clientId);assert.equal(tokenRequests,2);assert.equal(reads,4);
});

test('Document issuance returns a warning if Morning reports a Tax Authority confirmation error',async t=>{
  const c=await mcp(t),d=json(await c.call('prepare_morning_action',prepareInput('addDocument')));
  await c.control({taxAuthorityFailure:true});
  const outcome=json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash}));
  assert.equal(outcome.status,'succeeded');assert.equal(outcome.result.taxAuthorityConfirmationLastError,406);assert.match(outcome.result.warning,/do not issue another copy/);
  assert.equal((await c.requests()).filter(r=>r.write).length,1);
});

test('Malformed write responses leave the request needs_check and cannot trigger a duplicate document',async t=>{
  const c=await mcp(t),d=json(await c.call('prepare_morning_action',prepareInput('addDocument')));
  await c.control({invalidWrite:true});
  assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/Do not retry/);
  assert.equal(json(await c.call('request_status',{id:d.id})).status,'needs_check');
  assert.equal((await c.requests()).filter(r=>r.write).length,1);
});

test('Malformed email recipients and invalid dates are blocked before issuance',async t=>{
  const c=await mcp(t),bad=prepareInput('addDocument');bad.body.client.emails=['not an email'];
  assert.match(errorText(await c.call('prepare_morning_action',bad)),/valid email/);
  for(const dates of [{date:'2026-10-07'},{date:'2026-09-01'},{date:'2026-10-06',dueDate:'2026-10-05'}]){
    assert.match(errorText(await c.call('prepare_document',{requestKey:randomUUID(),clientId,type:305,title:'Fictional invoice',recipients:['fictional@example.com'],items:[{description:'Fictional service',quantity:1,price:100}],...dates})),/date/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('The convenient read tools accept Morning documented legacy identifier shapes',async t=>{
  const c=await mcp(t),id='031e827a-c664-c1e4-d231-a80027271123';
  assert.equal(json(await c.call('get_client',{id})).id,id);
  assert.equal(json(await c.call('get_document',{id})).document.id,id);
});
