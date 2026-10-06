import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {LocalStore,hash} from '../lib/store.mjs';
import {Actions} from '../lib/actions.mjs';

async function store(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-store-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return new LocalStore({dataDir:path.join(dir,'private'),environment:'production',connectionFingerprint:'fictional-key-version'});
}
test('Same request key and content reuse the same draft; changed content requires a fresh key',async t=>{
  const s=await store(t),id=randomUUID(),a=await s.save('api_action',id,'Fictional client',{operationId:'addClient',body:{name:'Fictional'}});
  const b=await s.save('api_action',id,'Fictional client',{operationId:'addClient',body:{name:'Fictional'}});
  assert.deepEqual(a,b);s.assertWaiting(b,a.payloadHash);
  await assert.rejects(s.save('api_action',id,'Changed title',a.payload),/fresh requestKey/);
  await assert.rejects(s.save('api_action',id,a.title,{...a.payload,body:{name:'Changed'}}),/fresh requestKey/);
  assert.equal((await fs.stat(s.file(id))).mode&0o777,0o600);assert.equal((await fs.stat(s.config.dataDir)).mode&0o777,0o700);
});
test('Connection changes, expired/future/invalid timestamps and edited review metadata are rejected',async t=>{
  const s=await store(t),d=await s.save('api_action',randomUUID(),'Fictional',{operationId:'addClient'});
  const other=new LocalStore({...s.config,connectionFingerprint:'different-key-version'});assert.throws(()=>other.assertWaiting(d,d.payloadHash),/Connection changed/);
  for(const createdAt of ['invalid',new Date(Date.now()-86400001).toISOString(),new Date(Date.now()+120000).toISOString()]){
    const changed={...d,createdAt};changed.payloadHash=hash(s.binding(changed));assert.throws(()=>s.assertWaiting(changed,changed.payloadHash),/expired|invalid date/);
  }
  for(const key of ['title','previewPath','id','createdAt'])assert.throws(()=>s.assertWaiting({...d,[key]:'changed'},d.payloadHash),/Draft changed/);
});
test('Canonical content hashes are independent of property order and locale collation',()=>{
  assert.equal(hash({'é':1,'é':2,a:3}),hash({a:3,'é':2,'é':1}));
  assert.notEqual(hash({a:[1,2]}),hash({a:[2,1]}));
});
test('A durable claim blocks execution even if the process failed before updating its status',async t=>{
  const s=await store(t),d=await s.save('api_action',randomUUID(),'Fictional',{operationId:'addClient'});
  await s.atomic(s.file(d.id,'claim'),{id:d.id,payloadHash:d.payloadHash},true);
  assert.equal((await s.status(d.id)).status,'needs_check');await assert.rejects(s.claim(d),/already started/);
});
test('Cancelled requests cannot authenticate or claim a draft',async t=>{
  const s=await store(t),d=await s.save('api_action',randomUUID(),'Fictional',{operationId:'addClient'});
  const actions=new Actions({...s.config,writesEnabled:true});let calls=0;actions.morning.authenticate=async()=>{calls++;};
  await assert.rejects(actions.execute(d,{signal:AbortSignal.abort()}),/abort/i);assert.equal(calls,0);
  assert.equal(await fs.stat(s.file(d.id,'claim')).catch(()=>null),null);
});
