import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Script} from 'node:vm';
import {setupBrowser} from '../lib/setup.mjs';

async function setup(t,{existing=false,broken=false,timeoutMs=5000}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'morning-setup-audit-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const configPath=path.join(dir,'private','config.json');
  if(existing||broken){await fs.mkdir(path.dirname(configPath),{recursive:true});if(broken)await fs.mkdir(configPath);else await fs.writeFile(configPath,JSON.stringify({id:'test-old-id',secret:'test-old-secret',environment:'production'}),{mode:0o600});}
  let ready;const opened=new Promise(resolve=>{ready=resolve;});
  const done=setupBrowser({configPath,openBrowser:false,timeoutMs,onReady:ready});done.catch(()=>{});
  const {url}=await opened,origin=new URL(url).origin;
  async function post(fields={id:'test-key-id',secret:'test-secret-not-real'},headers={}){
    return fetch(url,{method:'POST',headers:{Origin:origin,Accept:'application/json',...headers},body:new URLSearchParams(fields)});
  }
  const finish=()=>fetch(url+'/complete',{method:'POST',headers:{Origin:origin}});
  t.after(async()=>{await finish().catch(()=>{});await done.catch(()=>{});});
  return {url,origin,configPath,post,done,finish};
}
function badHost(url){return new Promise((resolve,reject)=>{
  const req=http.get(url,{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
});}

test('Setup shows a Hebrew RTL form, no test-account option, and a clear confirmation after saving',async t=>{
  const s=await setup(t),response=await fetch(s.url),html=await response.text();
  assert.match(html,/lang="he" dir="rtl"/);assert.doesNotMatch(html,/sandbox|name="environment"|חשבון בדיקה/);
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'.*connect-src 'self'/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];new Script(script);
  assert.match(script,/setTimeout.*10000/);assert.match(script,/success\.hidden=false/);assert.match(script,/status\.className='error'/);
  assert.deepEqual(await (await fetch(s.url+'/status')).json(),{saved:false});
  const saved=await s.post({id:'test-key-id',secret:'test-secret-not-real',environment:'sandbox'});assert.equal(saved.status,200);assert.deepEqual(await saved.json(),{saved:true});
  const config=JSON.parse(await fs.readFile(s.configPath,'utf8'));assert.equal(config.environment,'production');assert.equal(config.secret,'test-secret-not-real');
  assert.equal((await fs.stat(s.configPath)).mode&0o777,0o600);
  assert.deepEqual(await (await fetch(s.url+'/status')).json(),{saved:true});
  const confirmation=await (await fetch(s.url)).text();assert.match(confirmation,/המפתחות נשמרו/);assert.doesNotMatch(confirmation,/test-secret-not-real|<form/);
  // A repeated click confirms the original save without replacing its credentials.
  assert.deepEqual(await (await s.post({id:'test-other',secret:'test-other'})).json(),{saved:true});
  assert.deepEqual(JSON.parse(await fs.readFile(s.configPath)),config);
  await s.finish();await s.done;await assert.rejects(fetch(s.url));
});

test('Wrong host, origin, content type, token and oversized/empty values cannot save credentials',async t=>{
  const s=await setup(t);assert.equal(await badHost(s.url),404);
  assert.equal((await fetch(s.origin+'/setup/wrong-token')).status,404);
  assert.equal((await s.post(undefined,{Origin:'https://foreign.example'})).status,403);
  assert.equal((await s.post(undefined,{'Content-Type':'application/json'})).status,403);
  assert.equal((await s.post({id:'',secret:''})).status,400);
  assert.equal((await s.post({id:'test-id',secret:'x'.repeat(1025)})).status,400);
  assert.equal((await s.post({id:'x'.repeat(9000),secret:'test-secret'})).status,413);
  assert.equal(await fs.stat(s.configPath).catch(()=>null),null);
  assert.deepEqual(await (await fetch(s.url+'/status')).json(),{saved:false});
  await s.post();await s.finish();await s.done;
});

test('Replacing an existing connection requires explicit confirmation',async t=>{
  const s=await setup(t,{existing:true});
  assert.match(await (await fetch(s.url)).text(),/name="replace" value="yes" required/);
  assert.equal((await s.post()).status,409);
  assert.equal(JSON.parse(await fs.readFile(s.configPath)).id,'test-old-id');
  assert.equal((await s.post({id:'test-new-id',secret:'test-new-secret',replace:'yes'})).status,200);
  assert.equal(JSON.parse(await fs.readFile(s.configPath)).id,'test-new-id');await s.finish();await s.done;
});

test('A failed filesystem save returns a safe error, keeps saved=false and does not claim success',async t=>{
  const s=await setup(t,{broken:true,timeoutMs:250});
  const response=await s.post({id:'test-id',secret:'test-secret-not-real',replace:'yes'});assert.equal(response.status,500);
  const error=await response.text();assert.match(error,/השמירה לא הצליחה/);assert.doesNotMatch(error,/test-secret|config\.json|EISDIR/);
  assert.deepEqual(await (await fetch(s.url+'/status')).json(),{saved:false});
  await assert.rejects(s.done,/expired/);
});

test('Concurrent saves choose one connection; later requests cannot overwrite it',async t=>{
  const s=await setup(t);
  const responses=await Promise.all([s.post({id:'test-first',secret:'test-first-secret'}),s.post({id:'test-second',secret:'test-second-secret'})]);
  assert.ok(responses.some(r=>r.status===200));assert.ok(responses.every(r=>[200,409].includes(r.status)));
  const config=JSON.parse(await fs.readFile(s.configPath));assert.ok(['test-first','test-second'].includes(config.id));
  assert.equal(config.secret,config.id+'-secret');await s.finish();await s.done;
});

test('Expired local links stop accepting connections and save nothing',async t=>{
  const s=await setup(t,{timeoutMs:50});await assert.rejects(s.done,/expired/);
  await assert.rejects(fetch(s.url));assert.equal(await fs.stat(s.configPath).catch(()=>null),null);
});
