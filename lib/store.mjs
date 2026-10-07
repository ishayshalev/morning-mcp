import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {reviewText} from './review.mjs';
export function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const bytesHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const validId=id=>{if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new Error('Invalid draft or file ID.');return id;};
export class LocalStore{
  constructor(config){this.config=config;}
  file(id,suffix='json'){return path.join(this.config.dataDir,`${validId(id)}.${suffix}`);}
  async init(){await fs.mkdir(this.config.dataDir,{recursive:true,mode:0o700});await fs.chmod(this.config.dataDir,0o700);}
  async atomic(file,value,exclusive=false){
    await this.init();const temp=path.join(this.config.dataDir,`.${randomUUID()}.tmp`);
    try{
      const handle=await fs.open(temp,'wx',0o600);
      try{await handle.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
      if(exclusive)await fs.link(temp,file);else await fs.rename(temp,file);
    }
    finally{await fs.unlink(temp).catch(()=>{});}
    const directory=await fs.open(this.config.dataDir,'r');try{await directory.sync();}finally{await directory.close();}
  }
  async read(id){try{return JSON.parse(await fs.readFile(this.file(id),'utf8'));}catch(error){if(error.code==='ENOENT')throw new Error('Draft not found.');throw error;}}
  binding(d){return {schemaVersion:d.schemaVersion,id:d.id,title:d.title,kind:d.kind,payload:d.payload,previewPath:d.previewPath,createdAt:d.createdAt,environment:d.environment,connectionFingerprint:d.connectionFingerprint};}
  async save(kind,requestKey,title,payload,previewPath=null){
    const d={schemaVersion:1,id:requestKey,title,kind,payload,previewPath,environment:this.config.environment,connectionFingerprint:this.config.connectionFingerprint,status:'waiting',createdAt:new Date().toISOString(),result:null};
    d.payloadHash=hash(this.binding(d));
    try{await this.atomic(this.file(d.id),d,true);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const existing=await this.read(d.id);
      const content=value=>({kind:value.kind,payload:value.payload,title:value.title,previewPath:value.previewPath,environment:value.environment,connectionFingerprint:value.connectionFingerprint});
      if(existing.schemaVersion!==1||hash(content(existing))!==hash(content(d)))throw new Error('Request key already used for different content. Use a fresh requestKey.');
      return existing;
    }
    return d;
  }
  assertWaiting(d,expectedHash){
    if(d?.schemaVersion!==1||!['api_action','expense_upload'].includes(d.kind))throw new Error('Draft format changed. Prepare a new draft.');
    if(d.status!=='waiting')throw new Error('Draft already decided or started. Do not retry.');
    if(d.environment!==this.config.environment||d.connectionFingerprint!==this.config.connectionFingerprint)throw new Error('Connection changed. Prepare a new draft.');
    if(d.payloadHash!==expectedHash||hash(this.binding(d))!==expectedHash)throw new Error('Draft changed. Prepare and review a new draft.');
    const created=Date.parse(d.createdAt),age=Date.now()-created;
    if(!Number.isFinite(created)||age< -60000||age>86400000)throw new Error('Draft expired or has an invalid date. Prepare a new draft.');
  }
  async claim(d){
    try{await this.atomic(this.file(d.id,'claim'),{id:d.id,payloadHash:d.payloadHash,startedAt:new Date().toISOString()},true);}catch(error){if(error.code==='EEXIST')throw new Error('Draft already started. Check Morning; never retry it.');throw error;}
    await this.update(d,{status:'executing',startedAt:new Date().toISOString()});
  }
  async update(d,change){Object.assign(d,change,{updatedAt:new Date().toISOString()});await this.atomic(this.file(d.id),d);}
  async status(id){const d=await this.read(id);if(d.status==='waiting'&&await fs.stat(this.file(id,'claim')).catch(()=>null))d.status='needs_check';return this.summary(d);}
  summary(d){return {id:d.id,title:d.title,status:d.status,environment:d.environment,payloadHash:d.payloadHash,previewPath:d.previewPath,review:reviewText(d),confirmationRequired:d.status==='waiting',humanApprovalEnforced:false,result:d.result,message:d.status==='waiting'?'Prepared locally. Nothing created or sent in Morning.':d.status==='needs_check'||d.status==='executing'?'Check Morning before preparing another request. This may already have completed.':undefined};}
}
