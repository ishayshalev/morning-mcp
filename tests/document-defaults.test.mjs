import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mcp,json,apiInput} from './helpers.mjs';
import {withDocumentDefaults} from '../lib/document-drafts.mjs';

const card={id:'00000000-0000-4000-8000-0000000000aa',type:12200,status:0,active:true,groups:[100,120,150,160],currencies:['ILS'],settings:{maxPayments:1}};
const paypal={id:'00000000-0000-4000-8000-0000000000bb',type:12010,status:0,active:true,groups:[110],currencies:[]};
const info={payable:true,remark:{he:'פרטי בנק לדוגמה'},footer:{he:''},settings:{documentLang:'he',documentCurrency:'ILS',selectedPaymentChannels:[100,120,150,160]},paymentPlugins:[card,paypal]};
const body=()=>({...apiInput('createDocumentDraft').body});

test('Business defaults fill only the fields the caller left out',()=>{
 const filled=withDocumentDefaults(body(),info);
 assert.equal(filled.remarks,'פרטי בנק לדוגמה');assert.ok(!('footer' in filled));
 assert.deepEqual(filled.paymentRequestData,{plugins:[100,120,150,160].map(group=>({id:card.id,group,type:card.type})),maxPayments:1});
 const explicit=withDocumentDefaults({...body(),remarks:'',paymentRequestData:{}},info);
 assert.equal(explicit.remarks,'');assert.deepEqual(explicit.paymentRequestData,{});
 assert.ok(!('paymentRequestData' in withDocumentDefaults(body(),{...info,payable:false})));
 assert.ok(!('paymentRequestData' in withDocumentDefaults(body(),{...info,paymentPlugins:[{...card,active:false}]})));
 assert.ok(!('paymentRequestData' in withDocumentDefaults({...body(),currency:'USD'},info)));
});

test('Saved drafts carry the defaults; the same request key stays idempotent after defaults change',async t=>{
 const c=await mcp(t);await c.control({info});
 const args={requestKey:randomUUID(),title:'Fictional draft with defaults',body:body()};
 const saved=json(await c.call('save_document_draft',args));
 assert.equal(saved.result.doc.remarks,'פרטי בנק לדוגמה');assert.equal(saved.result.doc.paymentRequestData.plugins.length,4);
 assert.match(saved.review,/פרטי בנק לדוגמה/);
 await c.control({info:{...info,remark:{he:'changed'}}});
 assert.equal(json(await c.call('save_document_draft',args)).result.morningDraftId,saved.result.morningDraftId);
 assert.equal((await c.requests()).filter(r=>r.write).length,1);
});
