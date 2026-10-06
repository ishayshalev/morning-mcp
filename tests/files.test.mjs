import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mcp,json,errorText,pdf,clientId} from './helpers.mjs';

test('Staging and preparing receipt files stay local; only an accepted approval starts the two upload steps',async t=>{
  const c=await mcp(t),file=path.join(c.dir,'fictional-receipt.pdf');await fs.writeFile(file,pdf);
  const staged=json(await c.call('stage_expense_file',{filePath:file}));
  const d=json(await c.call('prepare_expense_upload',{requestKey:randomUUID(),fileId:staged.fileId,title:'Fictional receipt'}));
  assert.equal((await c.requests()).length,0);
  c.respond(()=>({action:'decline'}));assert.equal(json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})).status,'not_approved');
  assert.equal((await c.requests()).length,0);
  c.respond(()=>({action:'accept',content:{confirm:true}}));const outcome=json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash}));
  assert.equal(outcome.status,'succeeded');assert.equal(outcome.result.processing,'pending');
  const req=await c.requests(),signing=req.find(r=>r.operationId==='getExpenseFileUploadUrl'),upload=req.find(r=>r.operationId==='uploadExpenseFile');
  assert.deepEqual(signing.data,{source:5});assert.equal(upload.fieldNames.at(-1),'file');assert.equal(upload.fileSize,pdf.length);
  assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/already/);
  assert.equal((await c.requests()).filter(r=>r.write).length,1);
});

test('Attaching a receipt binds the expense ID and checks that the expense has not changed',async t=>{
  const c=await mcp(t),staged=json(await c.call('stage_expense_file',{name:'fictional.pdf',base64:pdf.toString('base64')}));
  const input={requestKey:randomUUID(),fileId:staged.fileId,title:'Fictional attachment',expenseId:clientId};
  const d=json(await c.call('prepare_expense_upload',input));
  c.respond(params=>{assert.ok(params.message.includes(clientId));return {action:'accept',content:{confirm:true}};});
  await c.control({resourceVersion:2});assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/Expense changed/);
  assert.ok((await c.requests()).every(r=>!r.write));
  await c.control({});assert.equal(json(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})).status,'succeeded');
  assert.deepEqual((await c.requests()).find(r=>r.operationId==='getExpenseFileUploadUrl').data,{id:clientId,source:5,state:'expense'});
});

test('Unsupported, oversized, ambiguous and invalid-base64 files are rejected locally',async t=>{
  const c=await mcp(t);
  for(const args of [
    {name:'fictional.txt',base64:Buffer.from('not a receipt').toString('base64')},
    {name:'fictional.pdf',base64:'%%%='},
    {name:'fictional.pdf',base64:'cA=='},
    {filePath:'relative.pdf'},
    {filePath:'/fictional.pdf',name:'bad.pdf',base64:pdf.toString('base64')},
  ])assert.equal((await c.call('stage_expense_file',args)).isError,true);
  const large=path.join(c.dir,'large.pdf'),handle=await fs.open(large,'w');await handle.truncate(20*1024*1024+1);await handle.close();
  assert.match(errorText(await c.call('stage_expense_file',{filePath:large})),/20 MB/);
  assert.equal((await c.requests()).length,0);
});

test('JPEG and PNG signatures are accepted regardless of the supplied file extension',async t=>{
  const c=await mcp(t);
  for(const [type,bytes] of [['image/png',Buffer.from([137,80,78,71,13,10,26,10,1])],['image/jpeg',Buffer.from([255,216,255,224,1])]]){
    const staged=json(await c.call('stage_expense_file',{name:'fictional.receipt',base64:bytes.toString('base64')}));assert.equal(staged.type,type);
  }
  assert.equal((await c.requests()).length,0);
});

test('Changed staged bytes and metadata cannot reach Morning upload',async t=>{
  const c=await mcp(t);
  for(const field of ['bytes','name','size','id']){
    const staged=json(await c.call('stage_expense_file',{name:'fictional.pdf',base64:pdf.toString('base64')}));
    const d=json(await c.call('prepare_expense_upload',{requestKey:randomUUID(),fileId:staged.fileId,title:'Fictional receipt'}));
    const {file}=await c.draft(d.id),dir=path.dirname(file),metadataFile=path.join(dir,`${staged.fileId}.file.json`);
    if(field==='bytes')await fs.writeFile(path.join(dir,`${staged.fileId}.bin`),'%PDF-altered');
    else{const metadata=JSON.parse(await fs.readFile(metadataFile));metadata[field]=field==='size'?999999:field==='id'?randomUUID():'Changed name';await fs.writeFile(metadataFile,JSON.stringify(metadata));}
    if(field==='id')assert.match(errorText(await c.call('prepare_expense_upload',{requestKey:randomUUID(),fileId:staged.fileId,title:'fictional'})),/changed/);
    c.respond(()=>({action:'accept',content:{confirm:true}}));assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/Receipt changed/);
  }
  assert.equal((await c.requests()).filter(r=>r.operationId==='getExpenseFileUploadUrl'||r.write).length,0);
});

test('Signed uploads reject foreign hosts, redirects, bad fields and provider size limits',async t=>{
  const c=await mcp(t);
  for(const control of [{signingUrl:'https://example.com/upload'},{signingUrl:'http://s3.eu-west-1.amazonaws.com/file'},{signingUrl:'https://s3.eu-west-1.amazonaws.com.evil.example/file'},{signingUrl:'https://name:password@s3.eu-west-1.amazonaws.com/file'},{maxFileSize:1},{badFields:{file:'reserved'}},{badFields:{key:{invalid:'object'}}}]){
    const staged=json(await c.call('stage_expense_file',{name:'fictional.pdf',base64:pdf.toString('base64')}));
    const d=json(await c.call('prepare_expense_upload',{requestKey:randomUUID(),fileId:staged.fileId,title:'Fictional receipt'}));
    await c.control(control);c.respond(()=>({action:'accept',content:{confirm:true}}));
    assert.match(errorText(await c.call('execute_draft',{id:d.id,payloadHash:d.payloadHash})),/Do not retry/);
    assert.equal(json(await c.call('request_status',{id:d.id})).status,'needs_check');
  }
  assert.equal((await c.requests()).filter(r=>r.write).length,0);
});
