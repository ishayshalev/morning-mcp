import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {operations} from '../lib/catalog.mjs';
import {mcp,json,errorText,prepareInput,apiInput,continuation,pdf,clientId} from './helpers.mjs';

test('All 16 tools remain discoverable before keys are saved, and saved keys reload without restart',async t=>{
  const c=await mcp(t,{configured:false});
  const list=await c.request('tools/list');assert.equal(list.tools.length,16);
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
  assert.equal(requests.filter(r=>r.operationId!=='authentication').length,25);
});

for(const op of operations.filter(o=>o.mode==='approval'))test(`${op.id}: preparation, decline, cancel and false confirmation cannot write; approval executes once`,async t=>{
  const c=await mcp(t),input=prepareInput(op.id),draft=json(await c.call('prepare_morning_action',input));
  assert.equal(draft.status,'waiting');assert.ok((await c.requests()).every(r=>!r.write));
  assert.match(errorText(await c.call('read_morning',apiInput(op.id))),/approval/);
  const args={id:draft.id,payloadHash:draft.payloadHash};
  for(const response of [{action:'decline'},{action:'cancel'},{action:'accept',content:{confirm:false}}]){
    c.respond(()=>response);const declined=json(await c.call('execute_draft',args));assert.equal(declined.status,'not_approved');
    assert.ok((await c.requests()).every(r=>!r.write));
  }
  c.respond(params=>{
    assert.ok(params.message.includes(op.id));assert.ok(params.message.includes(draft.payloadHash));assert.ok(params.message.includes(draft.id));
    return {action:'accept',content:{confirm:true,...(op.risk==='charge'?{confirmation:'CHARGE'}:op.risk==='destructive'?{confirmation:'CONFIRM'}:{})}};
  });
  assert.equal(json(await c.call('execute_draft',args)).status,'succeeded');
  assert.match(errorText(await c.call('execute_draft',args)),/already/);
  const writes=(await c.requests()).filter(r=>r.write);assert.equal(writes.length,1);assert.equal(writes[0].operationId,op.id);
  assert.deepEqual(writes[0].body,input.body);
});

test('Charge and deletion require the exact typed confirmation',async t=>{
  const c=await mcp(t);
  for(const id of ['chargeCreditCardToken','deleteClient']){
    const draft=json(await c.call('prepare_morning_action',prepareInput(id)));
    c.respond(()=>({action:'accept',content:{confirm:true,confirmation:'wrong'}}));
    assert.match(errorText(await c.call('execute_draft',{id:draft.id,payloadHash:draft.payloadHash})),/Type (CHARGE|CONFIRM)/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Clients without elicitation support can prepare but cannot execute',async t=>{
  for(const version of ['2025-11-25','2025-06-18','2025-03-26']){
    const c=await mcp(t,{version,capabilities:{}});
    const d=json(await c.call('prepare_morning_action',prepareInput('addClient')));
    assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/capability|elicitation/);
    assert.equal(c.dialogs.length,0);assert.ok((await c.requests()).every(r=>!r.write));
  }
});

test('2025-06-18 clients receive a real server-to-client elicitation request',async t=>{
  const c=await mcp(t,{version:'2025-06-18'}),d=json(await c.call('prepare_morning_action',prepareInput('addClient')));
  c.respond(()=>({action:'accept',content:{confirm:true}}));
  assert.equal(json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})).status,'succeeded');assert.equal(c.dialogs.length,1);
});

test('2026-07-28 continuations reject forged, expired, cross-draft and replayed confirmations',async t=>{
  const c=await mcp(t,{version:'2026-07-28'});
  const d=json(await c.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};
  const prompt=await c.call('execute_draft',args);assert.equal(prompt.resultType,'input_required');
  assert.ok(Object.values(prompt.inputRequests)[0].params.message.includes(d.payloadHash));
  await assert.rejects(c.call('execute_draft',args,{...continuation(prompt),requestState:prompt.requestState+'tampered'}),/Invalid or expired/);
  const other=json(await c.call('prepare_morning_action',prepareInput('addClient')));
  assert.equal((await c.call('execute_draft',{id:other.id,payloadHash:other.payloadHash},continuation(prompt))).resultType,'input_required');
  assert.equal((await c.call('execute_draft',args,{inputResponses:continuation(prompt).inputResponses})).resultType,'input_required');
  await c.control({clockOffset:601000});
  await assert.rejects(c.call('execute_draft',args,continuation(prompt)),/Invalid or expired/);
  await c.control({});
  assert.ok((await c.requests()).every(r=>!r.write));
  assert.equal(json(await c.call('execute_draft',args,continuation(prompt))).status,'succeeded');
  assert.match(errorText(await c.call('execute_draft',args,continuation(prompt))),/already/);
  assert.equal((await c.requests()).filter(r=>r.write).length,1);
});

test('Approval fields in tool arguments and unknown operations/fields cannot bypass the gate',async t=>{
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

test('Changing a prepared title, content, date or PDF invalidates the approval',async t=>{
  const c=await mcp(t,{version:'2026-07-28'});
  for(const field of ['title','payload','createdAt','preview']){
    const d=json(await c.call('prepare_morning_action',prepareInput(field==='preview'?'addDocument':'addClient'))),args={id:d.id,payloadHash:d.payloadHash};
    const prompt=await c.call('execute_draft',args),{file,record}=await c.draft(d.id);
    if(field==='preview')await fs.writeFile(record.previewPath,'%PDF-altered');
    else{if(field==='payload')record.payload.body.name='Changed recipient';else record[field]='changed';await fs.writeFile(file,JSON.stringify(record));}
    assert.match(errorText(await c.call('execute_draft',args,continuation(prompt))),/changed|invalid|expired/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Stale Morning records or business settings require a newly prepared draft',async t=>{
  const c=await mcp(t);
  for(const [id,control] of [['updateClient',{resourceVersion:2}],['addDocument',{info:{vatRate:.2}}]]){
    await c.control({});const d=json(await c.call('prepare_morning_action',prepareInput(id)));
    await c.control(control);c.respond(()=>({action:'accept',content:{confirm:true}}));
    assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/changed/);
  }
  assert.ok((await c.requests()).every(r=>!r.write));
});

test('Cross-process concurrent approvals produce at most one external write',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-race-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const a=await mcp(t,{sharedDir:dir}),b=await mcp(t,{sharedDir:dir});
  const d=json(await a.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};
  a.respond(()=>({action:'accept',content:{confirm:true}}));b.respond(()=>({action:'accept',content:{confirm:true}}));
  const attempts=await Promise.all(Array.from({length:8},(_,i)=>(i%2?a:b).call('execute_draft',args)));
  assert.equal(attempts.filter(r=>!r.isError).length,1);assert.equal((await a.requests()).filter(r=>r.write).length,1);
});

test('An uncertain write is recorded as needs_check and never retried, including after restart',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-uncertain-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const a=await mcp(t,{sharedDir:dir}),d=json(await a.call('prepare_morning_action',prepareInput('addClient'))),args={id:d.id,payloadHash:d.payloadHash};
  await a.control({failWrite:true});a.respond(()=>({action:'accept',content:{confirm:true}}));
  assert.match(errorText(await a.call('execute_draft',args)),/Do not retry/);assert.equal(json(await a.call('request_status',{id:d.id})).status,'needs_check');
  await a.close();const b=await mcp(t,{sharedDir:dir});b.respond(()=>({action:'accept',content:{confirm:true}}));
  assert.match(errorText(await b.call('execute_draft',args)),/already/);assert.equal((await b.requests()).filter(r=>r.write).length,1);
});

test('MORNING_WRITES_ENABLED=false preserves reads and drafts but blocks execution',async t=>{
  const c=await mcp(t,{writesEnabled:false}),d=json(await c.call('prepare_morning_action',prepareInput('addClient')));
  c.respond(()=>({action:'accept',content:{confirm:true}}));assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/disabled/);
  assert.equal(c.dialogs.length,0);assert.ok((await c.requests()).every(r=>!r.write));
});

test('Invoice preview and explicit email recipients precede issuance',async t=>{
  const c=await mcp(t),input={requestKey:randomUUID(),clientId,type:305,title:'Fictional invoice',recipients:['recipient@example.com'],items:[{description:'Fictional service',quantity:2,price:10.25}]};
  const d=json(await c.call('prepare_document',input));assert.deepEqual(await fs.readFile(d.previewPath),pdf);
  const preview=(await c.requests()).find(r=>r.operationId==='addPreviewDocument');assert.deepEqual(preview.body.client.emails,input.recipients);assert.equal(preview.body.currency,'ILS');
  assert.equal(preview.body.income[0].vatRate,.18);assert.ok((await c.requests()).every(r=>!r.write));
  c.respond(params=>{assert.ok(params.message.includes('recipient@example.com'));assert.ok(params.message.includes(d.previewPath));return {action:'decline'};});
  assert.equal(json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})).status,'not_approved');
  const missing=prepareInput('addDocument');delete missing.body.client.emails;
  assert.match(errorText(await c.call('prepare_morning_action',missing)),/emails explicitly/);
});
