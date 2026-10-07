import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {mcp,json,errorText,apiInput,clientId,pdf} from './helpers.mjs';
const input=()=>({requestKey:randomUUID(),title:'Fictional saved draft',body:apiInput('createDocumentDraft').body});
const writes=async c=>(await c.requests()).filter(r=>r.write);
const issue=async(c,id=clientId)=>json(await c.call('prepare_issue_document_draft',{id,requestKey:randomUUID(),title:'Review before issuing'}));

test('Native draft save, read, search, update and PDF preview never issue or send a document',async t=>{
 const c=await mcp(t,{capabilities:{}}),saved=json(await c.call('save_document_draft',input()));
 assert.equal(saved.status,'succeeded');assert.equal(saved.result.savedInMorning,true);assert.equal(saved.result.issued,false);assert.equal(c.dialogs.length,0);
 const id=saved.result.morningDraftId;assert.match(saved.result.morningDraftUrl,new RegExp(id));
 assert.equal(json(await c.call('get_document_draft',{id})).doc.type,305);
 assert.ok(json(await c.call('search_document_drafts')).items.some(d=>d.id===id));
 const update=input();update.draftId=id;update.body.description='Updated fictional draft';
 assert.equal(json(await c.call('save_document_draft',update)).result.morningDraftId,id);
 const preview=json(await c.call('preview_document_draft',{id}));assert.equal(preview.issued,false);assert.equal(preview.savedInMorning,true);
 assert.deepEqual(await fs.readFile(preview.previewPath),pdf);
 assert.deepEqual((await writes(c)).map(r=>r.operationId),['createDocumentDraft','updateDocumentDraft']);
});

test('Exact same save/update request keys are idempotent; changed content requires a new key',async t=>{
 const c=await mcp(t),args=input(),first=json(await c.call('save_document_draft',args));
 assert.equal(json(await c.call('save_document_draft',args)).result.morningDraftId,first.result.morningDraftId);
 assert.match(errorText(await c.call('save_document_draft',{...args,body:{...args.body,description:'different'}})),/different content/);
 const update={...input(),draftId:first.result.morningDraftId};
 json(await c.call('save_document_draft',update));json(await c.call('save_document_draft',update));
 assert.equal((await writes(c)).length,2);
});

test('Preparing native issuance binds the saved body and draftId; preparation leaves it editable until execution',async t=>{
 const c=await mcp(t),prepared=await issue(c),args={id:prepared.id,payloadHash:prepared.payloadHash};
 assert.equal(prepared.morningDraftId,clientId);assert.ok(prepared.previewPath);assert.equal((await writes(c)).length,0);
 assert.ok(json(await c.call('get_document_draft',{id:clientId})).doc);assert.equal((await writes(c)).length,0);
 assert.match(prepared.review,/המסמך יופק/);assert.equal(prepared.humanApprovalEnforced,false);
 assert.equal(json(await c.call('execute_draft',args)).status,'succeeded');
 const written=await writes(c);assert.equal(written.length,1);assert.equal(written[0].body.draftId,clientId);
 assert.match(errorText(await c.call('get_document_draft',{id:clientId})),/404/);
 assert.match(errorText(await c.call('execute_draft',args)),/already/);
 const previewCalls=(await c.requests()).filter(r=>r.operationId==='addPreviewDocument');assert.ok(previewCalls.every(r=>!('draftId' in r.body)));
});

test('Native edits after review block issuance, including changed recipients',async t=>{
 const c=await mcp(t),prepared=await issue(c);await c.control({nativeDoc:{client:{emails:['different@example.com'],name:'Changed'}}});

 assert.match(errorText(await c.call('execute_draft',{id:prepared.id,payloadHash:prepared.payloadHash})),/Target changed/);
 assert.equal((await writes(c)).length,0);
});

test('An unrelated payload cannot be linked to a native draft through the generic write tool',async t=>{
 const c=await mcp(t),body={...apiInput('addDocument').body,draftId:clientId,description:'different content'};
 assert.match(errorText(await c.call('prepare_morning_action',{requestKey:randomUUID(),title:'mismatch',operationId:'addDocument',body})),/does not match/);
 assert.equal((await writes(c)).length,0);
});

test('Unknown financial fields and unsupported date/VAT/attachments fail closed before preview or issuance',async t=>{
 const c=await mcp(t);
 for(const state of [{nativeDoc:{unknownFinancialSetting:true}},{nativeDoc:{prevVatRate:true}},{nativeDoc:{skipDateValidation:true}},{nativeDoc:{s3Keys:['file']}},{nativeDraft:{reverseCharge:true}},{nativeDoc:{income:[{...apiInput('addDocument').body.income[0],unexpectedTax:1}]}}]){
  await c.control(state);
  assert.match(errorText(await c.call('preview_document_draft',{id:clientId})),/unsupported/);
  assert.match(errorText(await c.call('prepare_issue_document_draft',{id:clientId,requestKey:randomUUID(),title:'unsupported'})),/unsupported/);
 }
 assert.equal((await c.requests()).filter(r=>r.operationId==='addPreviewDocument').length,0);assert.equal((await writes(c)).length,0);
});

test('Known native UI bookkeeping is stripped while financial values are preserved',async t=>{
 const c=await mcp(t);const row=apiInput('addDocument').body.income[0];
 await c.control({nativeDoc:{skipDateValidation:false,prevVatRate:false,s3Keys:[],amount:118,income:[{...row,uid:randomUUID()}]}});
 const prepared=await issue(c),{record}=await c.draft(prepared.id);
 assert.deepEqual(record.payload.body.income,[row]);assert.equal(record.payload.body.draftId,clientId);
 for(const key of ['skipDateValidation','prevVatRate','s3Keys','amount'])assert.ok(!(key in record.payload.body));
});

test('Disabled writes and implicit client creation block immediate draft saving',async t=>{
 const disabled=await mcp(t,{writesEnabled:false});assert.match(errorText(await disabled.call('save_document_draft',input())),/Writes disabled/);assert.equal((await writes(disabled)).length,0);
 const c=await mcp(t);for(const add of [true,undefined]){const args=input();args.body.client.add=add;assert.match(errorText(await c.call('save_document_draft',args)),/cannot also create a client/);}
 assert.equal((await writes(c)).length,0);
});

test('Uncertain native saves cannot be retried, including after restart',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-native-uncertain-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const c=await mcp(t,{sharedDir:dir}),args=input();await c.control({failWrite:true});
 assert.match(errorText(await c.call('save_document_draft',args)),/Do not retry/);await c.close();
 const restarted=await mcp(t,{sharedDir:dir});assert.equal(json(await restarted.call('save_document_draft',args)).status,'needs_check');assert.equal((await writes(restarted)).length,1);
});

test('Parallel immediate saves with one key create at most one native draft',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-native-race-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const a=await mcp(t,{sharedDir:dir}),b=await mcp(t,{sharedDir:dir}),args=input();
 const results=await Promise.all([a.call('save_document_draft',args),b.call('save_document_draft',args)]);
 assert.ok(results.some(r=>!r.isError&&json(r).status==='succeeded'));assert.equal((await writes(a)).length,1);
});

test('Changed native issuance PDF cannot be approved',async t=>{
 const c=await mcp(t),prepared=await issue(c);await fs.writeFile(prepared.previewPath,'%PDF-1.4 changed');
 assert.match(errorText(await c.call('execute_draft',{id:prepared.id,payloadHash:prepared.payloadHash})),/PDF preview changed/);assert.equal((await writes(c)).length,0);
});

test('Native nested draft identity is bookkeeping only when it matches the outer ID',async t=>{
 const c=await mcp(t);await c.control({nativeDoc:{id:clientId}});await issue(c);
 await c.control({nativeDoc:{id:randomUUID()}});assert.match(errorText(await c.call('preview_document_draft',{id:clientId})),/mismatched/);assert.equal((await writes(c)).length,0);
});
