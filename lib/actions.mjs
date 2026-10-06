import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Morning} from './morning.mjs';
import {LocalStore,hash,bytesHash} from './store.mjs';
import {validateOperation} from './catalog.mjs';

// Morning also documents legacy identifiers without an RFC UUID version/variant.
export const resourceId=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
export const documentInput=z.object({requestKey:z.string().uuid(),clientId:resourceId,type:z.union([z.literal(10),z.literal(300),z.literal(305)]),title:z.string().trim().min(1).max(200),date:z.iso.date().optional(),dueDate:z.iso.date().optional(),language:z.enum(['he','en']).default('he'),recipients:z.array(z.email()).min(1).max(5),emailText:z.string().max(2000).default(''),items:z.array(z.object({description:z.string().trim().min(1).max(500),quantity:z.number().int().min(1).max(10000),price:z.number().min(0.01).max(1e7).multipleOf(0.01),priceIncludesVat:z.boolean().default(false)}).strict()).min(1).max(30)}).strict();
const businessFingerprint=info=>hash({vatRate:info.vatRate,exemption:info.exemption,hasTaxAuthorityConfirmation:info.hasTaxAuthorityConfirmation,settings:info.settings});
const fileType=bytes=>bytes.subarray(0,5).toString()==='%PDF-'?'application/pdf':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':null;
async function receiptBytes(filePath){
  const handle=await fs.open(filePath,'r');
  try{
    const stat=await handle.stat(),limit=20*1024*1024;
    if(!stat.isFile()||stat.size>limit)throw new Error('Use a regular file no larger than 20 MB.');
    // Bound reads even if the file grows after stat().
    const chunks=[];let size=0;
    for await(const chunk of handle.createReadStream({autoClose:false})){size+=chunk.length;if(size>limit)throw new Error('Use a regular file no larger than 20 MB.');chunks.push(chunk);}
    return Buffer.concat(chunks,size);
  }finally{await handle.close();}
}
export class Actions{
  constructor(config){this.config=config;this.store=new LocalStore(config);this.morning=new Morning(config);}
  async snapshot(operationId,parameters,body){
    const resources={Item:'getItem',Client:'getClient',Supplier:'getSupplier',Expense:'getExpense',Document:'getDocument'};
    const resource=Object.keys(resources).find(key=>operationId.toLowerCase().includes(key.toLowerCase()));
    if(!resource||!parameters.id)return null;
    const primary=await this.morning.read(resources[resource],{id:parameters.id});
    const secondary=body?.mergeId?await this.morning.read(resources[resource],{id:body.mergeId}):null;
    return {primary,secondary};
  }
  async prepareApi(input){
    const {operation:o}=validateOperation(input.operationId,input.parameters,input.body);
    if(o.mode!=='approval')throw new Error('Use read_morning for this operation.');
    const before=await this.snapshot(o.id,input.parameters,input.body);
    let businessSettings=null,pdf=null;
    if(o.id==='addDocument'){
      if(!input.body?.client||!Array.isArray(input.body.client.emails))throw new Error('Specify client.emails explicitly: [] if no email is intended.');
      if(!input.body.client.emails.every(email=>z.email().safeParse(email).success))throw new Error('Use valid email addresses in client.emails, or [] if no email is intended.');
      businessSettings=businessFingerprint(await this.morning.info(Number(input.body.type)));
      const preview=await this.morning.preview(input.body);
      if(typeof preview.file!=='string'||preview.file.length>14*1024*1024||!/^[A-Za-z0-9+/]*={0,2}$/.test(preview.file)||preview.file.length%4!==0)throw new Error('Morning did not return a valid PDF preview.');
      pdf=Buffer.from(preview.file,'base64');
      if(pdf.toString('base64')!==preview.file||pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('Morning did not return a valid PDF preview.');
    }
    const payload={operationId:o.id,parameters:input.parameters,...(input.body?{body:input.body}:{}),operationFingerprint:o.fingerprint,risk:o.risk,before,beforeHash:before?hash(before):null,businessFingerprint:businessSettings,previewHash:pdf?bytesHash(pdf):null};
    const previewPath=pdf?this.store.file(input.requestKey,'pdf'):null;
    // Publishing the draft first binds any subsequent preview file to its hash.
    const draft=await this.store.save('api_action',input.requestKey,input.title,payload,previewPath);
    if(pdf)await this.store.atomic(previewPath,pdf);
    return this.store.summary(draft);
  }
  async prepareDocument(raw){
    const input=documentInput.parse(raw),morning=this.morning;
    const [client,info]=await Promise.all([morning.getClient(input.clientId),morning.info(input.type)]);
    if(client.active===false)throw new Error('Client is inactive.');
    if(info.incomeRowsEnabled!==true||info.incomeRowsRequired!==true)throw new Error('Use prepare_morning_action for this business/document type.');
    const date=input.date??String(info.today),lastDate=typeof info.lastDocumentDate==='string'?info.lastDocumentDate:'';
    if(!z.iso.date().safeParse(date).success||date>String(info.today)||(lastDate&&date<lastDate)||(input.dueDate&&input.dueDate<date))throw new Error('Check the document date and due date.');
    if(typeof info.vatRate!=='number'||typeof info.exemption!=='boolean')throw new Error('Morning returned incomplete VAT settings.');
    const clientSnapshot={id:input.clientId,emails:input.recipients,add:false,self:false};
    for(const key of ['name','taxId','address','city','zip','country'])if(typeof client[key]==='string')clientSnapshot[key]=client[key];
    const body={description:input.title,type:input.type,date,...(input.dueDate?{dueDate:input.dueDate}:{}),lang:input.language,currency:'ILS',vatType:info.exemption?1:0,signed:true,rounding:false,attachment:true,remarks:'',footer:'',emailContent:input.emailText,client:clientSnapshot,income:input.items.map(row=>({description:row.description,quantity:row.quantity,price:row.price,currency:'ILS',vatRate:info.vatRate,vatType:info.exemption?2:row.priceIncludesVat?1:0}))};
    return this.prepareApi({requestKey:input.requestKey,title:input.title,operationId:'addDocument',parameters:{},body});
  }
  async stage(name,bytes){
    if(bytes.length<4||bytes.length>20*1024*1024)throw new Error('Use a PDF/JPEG/PNG file between 4 bytes and 20 MB.');
    const type=fileType(bytes);
    if(!type)throw new Error('Only PDF, JPEG and PNG files are supported.');
    name=path.basename(name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);if(!name)throw new Error('A file name is required.');
    const id=randomUUID(),metadata={id,name,type,size:bytes.length,sha256:bytesHash(bytes)};
    await this.store.atomic(this.store.file(id,'bin'),bytes,true);
    await this.store.atomic(this.store.file(id,'file.json'),metadata,true);
    return {fileId:id,...metadata,message:'Stored locally; not uploaded to Morning.'};
  }
  async stagePath(filePath){
    if(!path.isAbsolute(filePath))throw new Error('Use an absolute path to the receipt file.');
    return this.stage(path.basename(filePath),await receiptBytes(filePath));
  }
  async prepareExpense(input){
    const file=JSON.parse(await fs.readFile(this.store.file(input.fileId,'file.json'),'utf8'));
    const bytes=await receiptBytes(this.store.file(input.fileId,'bin'));
    if(file.id!==input.fileId||file.sha256!==bytesHash(bytes)||file.size!==bytes.length||file.type!==fileType(bytes))throw new Error('Staged receipt changed. Stage the file again.');
    const before=input.expenseId?await this.morning.getExpense(input.expenseId):null;
    const payload={fileId:file.id,fileHash:file.sha256,fileName:file.name,size:file.size,type:file.type,...(input.expenseId?{expenseId:input.expenseId,before,beforeHash:hash(before)}:{})};
    const d=await this.store.save('expense_upload',input.requestKey,input.title,payload);
    return this.store.summary(d);
  }
  async review(id,expectedHash){const d=await this.store.read(id);if(d.id!==id)throw new Error('Draft identity changed. Prepare a new draft.');this.store.assertWaiting(d,expectedHash);return d;}
  approvalMessage(d){
    const p=d.payload;
    const redact=(key,value)=>/token|password|secret|cvv|cardNumber/i.test(key)?'[hidden credential]':value;
    const details=JSON.stringify(d.kind==='expense_upload'?p:{operation:p.operationId,parameters:p.parameters,body:p.body,before:p.before},redact,2);
    if(details.length>40000)throw new Error('Request is too large to review in the client dialog. Prepare a smaller request.');
    return `Approve this exact Morning action?\nEnvironment: ${d.environment}\nTitle: ${d.title}\nRisk: ${p.risk??'expense upload'}\nDraft: ${d.id}\nHash: ${d.payloadHash}\n${d.previewPath?`Review PDF first: ${d.previewPath}\n`:''}${d.kind==='expense_upload'?`Upload creates a parsed expense draft; finish recording it in Morning.\n`:''}${details}\nDecline to leave Morning unchanged.`;
  }
  async execute(d,{signal}={}){
    if(!this.config.writesEnabled)throw new Error('Writes disabled by MORNING_WRITES_ENABLED=false.');
    this.store.assertWaiting(d,d.payloadHash);
    const p=d.payload,morning=this.morning;
    signal?.throwIfAborted();
    await morning.authenticate();
    let upload;
    if(d.kind==='expense_upload'){
      const file=JSON.parse(await fs.readFile(this.store.file(p.fileId,'file.json'),'utf8'));
      const bytes=await receiptBytes(this.store.file(p.fileId,'bin'));
      if(file.id!==p.fileId||bytesHash(bytes)!==p.fileHash||file.sha256!==p.fileHash||file.type!==p.type||file.name!==p.fileName||file.size!==p.size||bytes.length!==p.size||fileType(bytes)!==p.type)throw new Error('Receipt changed. Prepare a new request.');
      if(p.expenseId&&hash(await morning.getExpense(p.expenseId))!==p.beforeHash)throw new Error('Expense changed in Morning. Prepare a new request.');
      upload={bytes,name:file.name,type:file.type};
    }else{
      const {operation:o}=validateOperation(p.operationId,p.parameters,p.body);
      if(o.mode!=='approval'||o.fingerprint!==p.operationFingerprint)throw new Error('Operation schema changed. Prepare a new draft.');
      if(p.beforeHash&&hash(await this.snapshot(o.id,p.parameters,p.body))!==p.beforeHash)throw new Error('Target changed in Morning. Prepare a new draft.');
      if(o.id==='addDocument'){
        if(businessFingerprint(await morning.info(Number(p.body.type)))!==p.businessFingerprint)throw new Error('Business settings changed. Prepare a new draft.');
        if(!d.previewPath||bytesHash(await fs.readFile(d.previewPath))!==p.previewHash)throw new Error('PDF preview changed. Prepare a new draft.');
      }
    }
    // A cross-process exclusive claim is persisted before any external write.
    signal?.throwIfAborted();
    await this.store.claim(d);
    try{
      const result=d.kind==='expense_upload'?await morning.uploadExpense(upload.bytes,upload.name,upload.type,p.expenseId):await morning.call(p.operationId,p.parameters,p.body);
      if(p.operationId==='addDocument'&&(typeof result.id!=='string'||typeof result.number!=='number'))throw new Error('Document outcome was not confirmed.');
      if(p.operationId==='addDocument'&&typeof result.taxAuthorityConfirmationLastError==='number'&&result.taxAuthorityConfirmationLastError!==0)result.warning='Document created. Morning reported a Tax Authority confirmation error. Check this document in Morning; do not issue another copy.';
      await this.store.update(d,{status:'succeeded',result});return this.store.summary(d);
    }catch{
      await this.store.update(d,{status:'needs_check',result:{message:'Check Morning before another request. The action may already have completed; no retry is performed.'}}).catch(()=>{});
      throw new Error('Outcome needs checking in Morning. Do not retry this action.');
    }
  }
}
