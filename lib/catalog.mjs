import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import {createHash} from 'node:crypto';
import {documentDraftOperations} from './document-drafts.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../generated/morning-api.json',import.meta.url),'utf8'));
const ajv=new Ajv({allErrors:true,strict:false,coerceTypes:false,removeAdditional:false});addFormats(ajv);
const documentOperation=catalog.operations.find(o=>o.id==='addDocument');
const nativeDrafts=documentDraftOperations(documentOperation.body);
// Morning's own app passes draftId to /documents when issuing a saved draft.
documentOperation.body.properties.draftId={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
documentOperation.extensions={draftId:'Observed in Morning’s own app. Links issuance to the saved native draft.'};
documentOperation.fingerprint=createHash('sha256').update(JSON.stringify(documentOperation)).digest('hex');
export const operations=[...catalog.operations,...nativeDrafts];
const validators=new Map(operations.map(o=>[o.id,{parameters:ajv.compile(o.parameters),body:o.body?ajv.compile(o.body):null}]));
export function operation(id){const o=operations.find(o=>o.id===id);if(!o)throw new Error('Unknown operation. Use api_operations.');return o;}
export function validateOperation(id,parameters={},body){
  const o=operation(id),v=validators.get(id);
  if(o.mode==='special')throw new Error(`Handled separately: ${o.special}.`);
  if(JSON.stringify({parameters,body}).length>200000)throw new Error('Request is too large.');
  if(!v.parameters(parameters))throw new Error(`Invalid parameters: ${ajv.errorsText(v.parameters.errors)}`);
  if(o.bodyRequired&&body===undefined)throw new Error('Request body is required.');
  if(body!==undefined&&(!v.body||!v.body(body)))throw new Error(`Invalid body: ${v.body?ajv.errorsText(v.body.errors):'operation takes no body'}`);
  for(const p of o.sources)if(p.in==='path'&&!/^[a-zA-Z0-9_-]{1,200}$/.test(String(parameters[p.name])))throw new Error('Invalid resource identifier.');
  if(o.id==='getSupportedCurrencies'&&!/^[A-Z]{3}$/.test(String(parameters.base)))throw new Error('Use a three-letter currency code.');
  return {operation:o};
}
export function operationUrl(o,environment,parameters){
  const base=o.host==='reference'?'https://cache.greeninvoice.co.il':environment==='production'?'https://api.greeninvoice.co.il/api/v1':'https://sandbox.d.greeninvoice.co.il/api/v1';
  let route=o.path;
  for(const p of o.sources)if(p.in==='path')route=route.replace(`{${p.name}}`,encodeURIComponent(String(parameters[p.name])));
  if(route.includes('{'))throw new Error('Missing resource identifier.');
  const url=new URL(base+route);
  for(const p of o.sources)if(p.in==='query'&&parameters[p.name]!==undefined)url.searchParams.set(p.name,String(parameters[p.name]));
  return url;
}
