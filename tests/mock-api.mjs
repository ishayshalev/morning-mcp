// Loaded only by the audit harness. Every fetch is intercepted; no network fallback exists.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {operations,operationUrl} from '../lib/catalog.mjs';
import {pdf,clientId} from './helpers.mjs';
const dir=process.env.MORNING_AUDIT_DIR;
if(!dir)throw new Error('The fictional API requires an isolated audit directory.');
const control=()=>{try{return JSON.parse(fs.readFileSync(path.join(dir,'control.json'),'utf8'));}catch{return {};}};
const now=Date.now.bind(Date);Date.now=()=>now()+(control().clockOffset??0);
function record(value){fs.appendFileSync(path.join(dir,'requests.jsonl'),JSON.stringify(value)+'\n');}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const nativeFile=path.join(dir,'native-drafts.json');
function nativeDrafts(){try{return JSON.parse(fs.readFileSync(nativeFile,'utf8'));}catch{return {[clientId]:{id:clientId,doc:{type:305,lang:'he',currency:'ILS',vatType:0,client:{name:'Fictional audit client',emails:[]},income:[{description:'Fictional service',quantity:1,price:100,currency:'ILS',vatType:0}]},reverseCharge:false}};}}
function saveNative(records){fs.writeFileSync(nativeFile,JSON.stringify(records));}
globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),method=options.method??'GET',state=control();
  if(options.redirect!=='error')throw new Error('All fictional requests must reject redirects.');
  if(url.origin==='https://api.morning.co'&&url.pathname==='/idp/v1/oauth/token'){
    record({operationId:'authentication',write:false});
    const body=JSON.parse(options.body);
    if(!body.client_id.startsWith('test-')||!body.client_secret.startsWith('test-'))throw new Error('Real credentials are forbidden in the fictional audit.');
    if(state.authFailure)return json({error:state.authFailure,error_description:'Do not expose this provider text'},401);
    return json(state.badToken?{accessToken:''}:{accessToken:'fictional-access-token',tokenType:'Bearer',expiresAt:Math.floor(Date.now()/1000)+3600});
  }
  if(url.origin==='https://api.morning.co'&&url.pathname==='/file-upload/v1/url'){
    record({operationId:'getExpenseFileUploadUrl',write:false,data:JSON.parse(url.searchParams.get('data'))});
    return json({url:state.signingUrl??'https://s3.eu-west-1.amazonaws.com/fictional-audit-bucket',maxFileSize:state.maxFileSize??20*1024*1024,fields:state.badFields??{key:'fictional-file',Policy:'fictional-policy','X-Amz-Signature':'fictional-signature'}});
  }
  if(url.hostname==='s3.eu-west-1.amazonaws.com'){
    const entries=[...options.body.entries()];
    record({operationId:'uploadExpenseFile',write:true,fieldNames:entries.map(([key])=>key),fileSize:entries.at(-1)[1].size});
    if(state.failWrite)throw new Error('Fictional connection lost after submission.');
    return new Response(null,{status:204});
  }
  const op=operations.find(o=>{
    if(o.mode==='special'||o.method!==method)return false;
    const base=operationUrl(o,'production',Object.fromEntries(o.sources.filter(p=>p.in==='path').map(p=>[p.name,'AUDIT_ID'])));
    return base.origin===url.origin&&new RegExp('^'+base.pathname.replaceAll('AUDIT_ID','[a-zA-Z0-9_-]+')+'$').test(url.pathname);
  });
  if(!op)throw new Error(`Network blocked: no fictional handler for ${method} ${url.pathname}`);
  if(op.host==='reference'&&options.headers?.Authorization)throw new Error('Credentials sent to a public reference endpoint.');
  if(op.host!=='reference'&&options.headers?.Authorization!=='Bearer fictional-access-token')throw new Error('Missing fictional access token.');
  const body=options.body?JSON.parse(options.body):undefined;
  record({operationId:op.id,write:op.mode==='approval',method,query:Object.fromEntries(url.searchParams),...(body?{body}:{})});
  if(op.mode==='approval'){
    if(state.failWrite)throw new Error('Fictional connection lost after submission.');
    if(state.invalidWrite)return new Response('not-json',{status:201});
    if(['createDocumentDraft','updateDocumentDraft','duplicateDocumentDraft','deleteDocumentDraft'].includes(op.id)){
      const records=nativeDrafts(),target=url.pathname.split('/').at(op.id==='duplicateDocumentDraft'?-2:-1);
      if(op.id==='deleteDocumentDraft'){delete records[target];saveNative(records);return new Response(null,{status:204});}
      const id=op.id==='updateDocumentDraft'?target:randomUUID();
      const doc={...(op.id==='duplicateDocumentDraft'?records[target]?.doc:body),id};
      const draft={id,doc,reverseCharge:false,lastUpdateDate:new Date().toISOString()};records[id]=draft;saveNative(records);return json(draft,201);
    }
    if(op.method==='DELETE')return new Response(null,{status:204});
    if(op.id==='addDocument'&&body.draftId){const records=nativeDrafts();delete records[body.draftId];saveNative(records);}
    return json(op.id==='addDocument'?{id:clientId,number:10001,type:body.type,...(state.taxAuthorityFailure?{taxAuthorityConfirmationLastError:406}:{})}:{id:clientId,completed:true},201);
  }
  if(op.id==='addPreviewDocument')return json({file:state.badPreview??pdf.toString('base64')});
  if(op.id==='getDocumentDraft'){
    const draft=nativeDrafts()[url.pathname.split('/').at(-1)];
    if(!draft)return json({error:'not_found'},404);
    return json({...draft,...state.nativeDraft,...(state.nativeDoc?{doc:{...draft.doc,...state.nativeDoc}}:{})});
  }
  if(op.id==='searchDocumentDrafts')return json({items:Object.values(nativeDrafts()),page:body?.page??1});
  if(op.id==='countDocumentDrafts')return json({count:Object.keys(nativeDrafts()).length});
  if(op.id==='getDocumentInformation')return json({type:Number(url.searchParams.get('type')),today:'2026-10-06',lastDocumentDate:'2026-10-01',vatRate:.18,exemption:false,incomeRowsEnabled:true,incomeRowsRequired:true,settings:{documentCurrency:'ILS'},hasTaxAuthorityConfirmation:false,...state.info});
  if(['getClient','getSupplier','getItem','getExpense','getDocument'].includes(op.id))return json({id:url.pathname.split('/').at(-1),name:'Fictional audit client',active:true,taxId:'fictional',version:state.resourceVersion??1,...state.resource});
  if(op.id==='getDocumentTypes')return json([{id:305,name:'Fictional tax invoice'}]);
  return json({items:[],page:body?.page??1});
};
