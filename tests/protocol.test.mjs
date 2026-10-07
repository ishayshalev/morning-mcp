import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {operations} from '../lib/catalog.mjs';
import {mcp,json,errorText,prepareInput,apiInput,pdf,clientId} from './helpers.mjs';

test('All 21 tools remain discoverable before keys are saved, and saved keys reload without restart',async t=>{
  const c=await mcp(t,{configured:false});
  const list=await c.request('tools/list');assert.equal(list.tools.length,21);
  const initial=json(await c.call('connection_status'));assert.equal(initial.keysConfigured,false);assert.equal(initial.writesEnabled,false);
  assert.match(errorText(await c.call('search_clients',{name:'fictional'})),/not saved/);
  assert.equal((await c.requests()).length,0);
  await fs.writeFile(path.join(c.dir,'config.json'),JSON.stringify({id:'test-reloaded-key',secret:'test-reloaded-secret',environment:'production'}),{mode:0o600});
  const connected=json(await c.call('connection_status',{verifyMorning:true}));assert.equal(connected.morningVerification,'authentication_and_read_verified');
  assert.equal(connected.keysConfigured,true);assert.ok((await c.requests()).every(r=>!r.write));
});

test('Every catalog read routes through a fixed documented endpoint',async t=>{
  const c=await mcp(t);
  for(const op of operations.filter(o=>o.mode==='read'))json(await c.call('read_morning',apiInput(op.id)));
  const requests=await c.requests();assert.equal(requests.filter(r=>r.write).length,0);
  assert.equal(requests.filter(r=>r.operationId==='authentication').length,1);
  assert.equal(requests.filter(r=>r.operationId!=='authentication').length,28);
});

for(const op of operations.filter(o=>o.mode==='approval'))test(`${op.id}: preparation stays read-only; explicit execution has no custom dialog and runs once`,async t=>{
  const c=await mcp(t,{capabilities:{}}),input=prepareInput(op.id),draft=json(await c.call('prepare_morning_action',input));
  assert.equal(draft.status,'waiting');assert.equal(draft.humanApprovalEnforced,false);assert.equal(draft.confirmationRequired,true);assert.ok(draft.review);assert.ok((await c.requests()).every(r=>!r.write));
  assert.match(errorText(await c.call('read_morning',apiInput(op.id))),/approval/);
  const args={id:draft.id,payloadHash:draft.payloadHash};
  assert.equal(json(await c.call('execute_draft',args)).status,'succeeded');assert.equal(c.dialogs.length,0);
  assert.match(errorText(await c.call('execute_draft',args)),/already/);
  const writes=(await c.requests()).filter(r=>r.write);assert.equal(writes.length,1);assert.equal(writes[0].operationId,op.id);assert.deepEqual(writes[0].body,input.body);
});

test('Connection status and server instructions disclose chat-only consent and require the agent to wait',async t=>{
 const c=await mcp(t),status=json(await c.call('connection_status'));assert.equal(status.approval,'chat_confirmation');assert.equal(status.humanApprovalEnforced,false);
 assert.match(c.instructions,/wait for the user’s explicit reply/);assert.match(c.instructions,/not server-enforced human approval/);assert.match(c.instructions,/If declined or unclear, do not execute/);
 assert.equal(c.dialogs.length,0);assert.equal((await c.requests()).length,0);
});

test('All supported protocol clients can execute without elicitation, typed codes or approval arguments',async t=>{
 for(const version of ['2025-11-25','2025-06-18','2026-07-28']){
  const c=await mcp(t,{version,capabilities:{}}),draft=json(await c.call('prepare_morning_action',prepareInput('deleteClient')));
  assert.equal(json(await c.call('execute_draft',{id:draft.id,payloadHash:draft.payloadHash})).status,'succeeded');assert.equal(c.dialogs.length,0);
 }
});

test('Extra execution arguments and unknown operations or fields remain rejected',async t=>{
  const c=await mcp(t),d=json(await c.call('prepare_morning_action',prepareInput('addClient')));
  const bypass=await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash,approved:true});assert.equal(bypass.isError,true);
  for(const operationId of ['https://example.com/write','obtainAccessToken','getExpenseFileUploadUrl','uploadExpenseFile','getPartnerUsers','requestUserApproval','disconnectPartnerUser']){
    assert.equal((await c.call('read_morning',{operationId})).isError,true);
    assert.equal((await c.call('prepare_morning_action',{operationId,requestKey:randomUUID(),title:'fictional'})).isError,true);
  }
  assert.equal((await c.call('prepare_morning_action',{...prepareInput('addClient'),body:{name:'Fictional',secret:'forbidden extra field'}})).isError,true);
  assert.equal((await c.call('read_morning',{operationId:'getClient',parameters:{id:'../../etc/passwd'}})).isError,true);
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Changing a prepared title, content, date or PDF blocks execution',async t=>{
  const c=await mcp(t,{version:'2026-07-28'});
  for(const field of ['title','payload','createdAt','preview']){
    const d=json(await c.call('prepare_morning_action',prepareInput(field==='preview'?'addDocument':'addClient'))),args={id:d.id,payloadHash:d.payloadHash};
    const {file,record}=await c.draft(d.id);
    if(field==='preview')await fs.writeFile(record.previewPath,'%PDF-altered');
    else{if(field==='payload')record.payload.body.name='Changed recipient';else record[field]='changed';await fs.writeFile(file,JSON.stringify(record));}
    assert.match(errorText(await c.call('execute_draft',args)),/changed|invalid|expired/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Stale Morning records or business settings require a newly prepared draft',async t=>{
  const c=await mcp(t);
  for(const [id,control] of [['updateClient',{resourceVersion:2}],['addDocument',{info:{vatRate:.2}}]]){
    await c.control({});const d=json(await c.call('prepare_morning_action',prepareInput(id)));
    await c.control(control);
    assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/changed/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Cross-process concurrent executions produce at most one external write',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-race-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const a=await mcp(t,{sharedDir:dir}),b=await mcp(t,{sharedDir:dir});
  const d=json(await a.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};

  const attempts=await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).call('execute_draft',args)));
  assert.equal(attempts.filter(r=>!r.isError).length,1);assert.equal((await a.requests()).filter(r=>r.write).length,1);
});

test('An uncertain write is recorded as needs_check and never retried, including after restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-uncertain-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const a=await mcp(t,{sharedDir:dir}),d=json(await a.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};
  await a.control({failWrite:true});
  assert.match(errorText(await a.call('execute_draft',args)),/Do not retry/);assert.equal(json(await a.call('request_status',{id:d.id})).status,'needs_check');
  await a.close();const b=await mcp(t,{sharedDir:dir});
  assert.match(errorText(await b.call('execute_draft',args)),/already/);assert.equal((await b.requests()).filter(r=>r.write).length,1);
});

test('MORNING_WRITES_ENABLED=false preserves reads and drafts but blocks execution',async t=>{
  const c=await mcp(t,{writesEnabled:false}),d=json(await c.call('prepare_morning_action',prepareInput('addClient')));
  assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/disabled/);
  assert.equal(c.dialogs.length,0);assert.ok((await c.requests()).every(r=>!r.write));
});

test('Invoice preview and explicit email recipients precede issuance',async t=>{
  const c=await mcp(t),input={requestKey:randomUUID(),clientId,type:305,title:'Fictional invoice',recipients:['recipient@example.com'],items:[{description:'Fictional service',quantity:2,price:10.25}]};
  const d=json(await c.call('prepare_document',input));assert.deepEqual(await fs.readFile(d.previewPath),pdf);
  const preview=(await c.requests()).find(r=>r.operationId==='addPreviewDocument');assert.deepEqual(preview.body.client.emails,input.recipients);assert.equal(preview.body.currency,'ILS');
  assert.equal(preview.body.income[0].vatRate,.18);assert.ok((await c.requests()).every(r=>!r.write));
  assert.ok(d.review.includes('recipient@example.com'));assert.ok(d.review.includes('PDF'));assert.equal(c.dialogs.length,0);
  const missing=prepareInput('addDocument');delete missing.body.client.emails;
  assert.match(errorText(await c.call('prepare_morning_action',missing)),/emails explicitly/);
});
