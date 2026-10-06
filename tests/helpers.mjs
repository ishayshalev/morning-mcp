import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {operation} from '../lib/catalog.mjs';

export const clientId='00000000-0000-4000-8000-000000000001';
export const otherId='00000000-0000-4000-8000-000000000002';
export const pdf=Buffer.from('%PDF-1.4\n% fictional audit fixture\n%%EOF\n');
const root=fileURLToPath(new URL('../',import.meta.url));
export function json(result){assert.equal(result.isError,undefined,JSON.stringify(result));return JSON.parse(result.content[0].text);}
export function errorText(result){assert.equal(result.isError,true,JSON.stringify(result));return result.content[0].text;}
export function sample(schema,name=''){
  if(schema.enum)return schema.enum[0];
  if(schema.default!==undefined)return schema.default;
  if(schema.type==='object')return Object.fromEntries((schema.required??[]).map(key=>[key,sample(schema.properties[key],key)]));
  if(schema.type==='array')return Array.from({length:schema.minItems??1},()=>sample(schema.items,name));
  if(schema.type==='boolean')return false;
  if(schema.type==='integer'||schema.type==='number')return Math.max(schema.minimum??0,1);
  if(schema.format==='uuid'||name==='id'||name==='mergeId')return clientId;
  if(schema.format==='date'||/Date$/.test(name)||name==='date')return '2026-10-06';
  if(name==='currency'||name==='base')return 'ILS';
  if(name==='reportingDate')return '2026-10-01';
  if(name==='lang')return 'he';
  if(name==='locale')return 'he_IL';
  if(name==='country')return 'IL';
  return 'Fictional audit value';
}
export function apiInput(id){
  const op=operation(id),parameters=sample(op.parameters),body=op.body?sample(op.body):undefined;
  if(id==='addDocument'||id==='addPreviewDocument')Object.assign(body,{type:305,lang:'he',currency:'ILS',vatType:0,client:{id:clientId,name:'Fictional audit client',emails:[]},income:[{description:'Fictional service',quantity:1,price:100,currency:'ILS',vatType:0}]});
  if(id==='mergeClients'||id==='mergeSuppliers')body.mergeId=otherId;
  return {operationId:id,parameters,...(body?{body}:{})};
}
export const prepareInput=id=>({...apiInput(id),requestKey:randomUUID(),title:`Fictional ${id} audit`});

export async function mcp(t,{version='2025-11-25',capabilities={elicitation:{form:{}}},configured=true,writesEnabled=true,sharedDir}={}){
  const dir=sharedDir??await fs.mkdtemp(path.join(os.tmpdir(),'morning-audit-'));
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('MORNING_'))delete env[key];
  Object.assign(env,{MORNING_CONFIG_FILE:path.join(dir,'config.json'),MORNING_DATA_DIR:path.join(dir,'data'),MORNING_WRITES_ENABLED:String(writesEnabled),MORNING_AUDIT_DIR:dir});
  if(configured)Object.assign(env,{MORNING_CLIENT_ID:'test-key-id-not-real',MORNING_CLIENT_SECRET:'test-secret-not-real'});
  const child=spawn(process.execPath,['--import',path.join(root,'tests/mock-api.mjs'),path.join(root,'bin/morning-mcp.mjs')],{env,stdio:['pipe','pipe','pipe']});
  let sequence=0,buffer='',stderr='';const pending=new Map();
  let elicit=()=>({action:'decline'});const dialogs=[];
  function send(message){child.stdin.write(JSON.stringify(message)+'\n');}
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  child.stdout.on('data',chunk=>{
    buffer+=chunk;let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
      const msg=JSON.parse(line);
      if(msg.method==='elicitation/create'){
        dialogs.push(msg.params);
        Promise.resolve().then(()=>elicit(msg.params)).then(value=>send({jsonrpc:'2.0',id:msg.id,result:value}),error=>send({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:error.message}}));
      }else if(pending.has(msg.id)){
        const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);
        if(msg.error){const e=new Error(msg.error.message);e.code=msg.error.code;p.reject(e);}else p.resolve(msg.result);
      }
    }
  });
  child.on('exit',code=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(`MCP exited (${code}): ${stderr}`));}pending.clear();});
  const modern=version==='2026-07-28';
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`MCP timed out: ${method}. ${stderr}`));},10000);
    pending.set(id,{resolve,reject,timer});
    send({jsonrpc:'2.0',id,method,params:{...params,...(modern?{_meta:{'io.modelcontextprotocol/protocolVersion':version,'io.modelcontextprotocol/clientInfo':{name:'fictional-morning-audit',version:'1.0'},'io.modelcontextprotocol/clientCapabilities':capabilities}}:{})}});
  });
  const close=async()=>{
    if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),1500);await exited;clearTimeout(timer);}
    if(!sharedDir)await fs.rm(dir,{recursive:true,force:true});
  };
  t.after(close);
  if(!modern){await request('initialize',{protocolVersion:version,capabilities,clientInfo:{name:'fictional-morning-audit',version:'1.0'}});send({jsonrpc:'2.0',method:'notifications/initialized'});}
  return {
    dir,child,dialogs,request,close,
    call:(name,args={},continuation={})=>request('tools/call',{name,arguments:args,...continuation}),
    respond:fn=>{elicit=fn;},
    requests:async()=>{try{return (await fs.readFile(path.join(dir,'requests.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if(e.code==='ENOENT')return [];throw e;}},
    control:value=>fs.writeFile(path.join(dir,'control.json'),JSON.stringify(value)),
    draft:async id=>{const accounts=await fs.readdir(path.join(dir,'data'));const file=path.join(dir,'data',accounts[0],`${id}.json`);return {file,record:JSON.parse(await fs.readFile(file,'utf8'))};},
  };
}
export function continuation(prompt,{action='accept',confirm=true,confirmation}={}){
  const key=Object.keys(prompt.inputRequests)[0];
  return {requestState:prompt.requestState,inputResponses:{[key]:{action,content:{confirm,...(confirmation?{confirmation}:{})}}}};
}
