import {createHash} from 'node:crypto';

export const draftApiSource='https://static.greeninvoice.co.il/app/assets/1.0.660/js/app.73edfe63.js';
const resource={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$'};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export function documentDraftOperations(documentBody){
  const body=structuredClone(documentBody);
  const search=object({page:{type:'integer',minimum:1},pageSize:{type:'integer',minimum:1,maximum:100},types:{type:'array',items:{type:'integer'},maxItems:30}});
  return [
    ['searchDocumentDrafts','POST','/documents/drafts/search','Search saved document drafts','read',search],
    ['countDocumentDrafts','GET','/documents/drafts/count','Count saved document drafts','read'],
    ['getDocumentDraft','GET','/documents/drafts/{id}','Read a saved document draft','read'],
    ['createDocumentDraft','POST','/documents/drafts','Save an editable document draft','approval',body],
    ['updateDocumentDraft','PUT','/documents/drafts/{id}','Update an editable document draft','approval',body],
    ['deleteDocumentDraft','DELETE','/documents/drafts/{id}','Delete an editable document draft','approval'],
    ['duplicateDocumentDraft','POST','/documents/drafts/{id}/duplicate','Duplicate an editable document draft','approval'],
  ].map(([id,method,path,title,mode,requestBody])=>{
    const hasId=path.includes('{id}');
    const o={id,method,path,title,group:'Document drafts',description:'Native Morning document drafts. Observed in Morning’s own app; absent from its published OpenAPI specification. Uses the account API key, never browser cookies.',mode,risk:method==='DELETE'?'destructive':mode==='read'?'none':'change',host:'business',parameters:object(hasId?{id:resource}:{},hasId?['id']:[]),sources:hasId?[{in:'path',name:'id'}]:[],...(requestBody?{body:requestBody,bodyRequired:true}:{}),source:draftApiSource,documentation:'observed_first_party_app',reviewedAt:'2026-10-07'};
    return {...o,fingerprint:createHash('sha256').update(JSON.stringify(o)).digest('hex')};
  });
}

// UI-only bookkeeping may be omitted; unknown financial fields must never be dropped silently.
export function documentBodyFromDraft(draft,schema){
  if(!draft?.doc||typeof draft.doc!=='object'||Array.isArray(draft.doc))throw new Error('Morning returned an invalid saved document draft.');
  const doc=draft.doc;
  if(doc.id!==undefined&&doc.id!==draft.id)throw new Error('Saved draft contains a mismatched document identity.');
  if(doc.skipDateValidation||doc.prevVatRate||doc.s3Keys?.length||draft.reverseCharge)throw new Error('This saved draft uses unsupported date/VAT/attachment/self-invoice settings. Review it in Morning.');
  function clean(value,definition,level='document'){
    if(definition.type==='array'){if(!Array.isArray(value))throw new Error('Saved draft contains an invalid list.');return value.map(item=>clean(item,definition.items,'row'));}
    if(definition.type!=='object'||!value||typeof value!=='object')return value;
    const result={};
    for(const [key,item] of Object.entries(value)){
      if(definition.properties?.[key])result[key]=clean(item,definition.properties[key],key);
      else if(level==='document'&&['id','skipDateValidation','prevVatRate','s3Keys','amount'].includes(key))continue;
      else if(level==='row'&&key==='uid')continue;
      else throw new Error(`Saved draft contains an unsupported field: ${level}.${key}. Review it in Morning.`);
    }
    return result;
  }
  return clean(doc,schema);
}

export function documentDraftLink(id,type){
  const section=[305,320,330,400,405,410].includes(Number(type))?'incomes':'business';
  return `https://app.greeninvoice.co.il/${section}/documents/new/${Number(type)}?draftId=${encodeURIComponent(id)}`;
}
