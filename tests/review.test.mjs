import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewText} from '../lib/review.mjs';
import {mcp,json,prepareInput,clientId} from './helpers.mjs';

test('Draft deletion review shows the document, client and amount without JSON, internal IDs or hashes',()=>{
 const d={id:clientId,title:'Technical title',environment:'production',payloadHash:'abcdef'.repeat(10),payload:{operationId:'deleteDocumentDraft',parameters:{id:clientId},risk:'destructive',before:{id:clientId,doc:{type:10,client:{name:'לקוח לדוגמה'},description:'טיוטת בדיקה',amount:1,currency:'ILS'}}}};
 const text=reviewText(d);for(const value of ['מחיקת טיוטה','הצעת מחיר','לקוח לדוגמה','טיוטת בדיקה','1 ILS'])assert.ok(text.includes(value));assert.doesNotMatch(text,/payload|beforeHash|CONFIRM|abcdef|00000000|[{}]/);
});

test('Invoice review includes recipients and line values; empty recipients explicitly mean no email',async t=>{
 const c=await mcp(t);const input=prepareInput('addDocument');input.body.client.emails=['review@example.com'];const prepared=json(await c.call('prepare_morning_action',input));
 for(const value of ['review@example.com','Fictional service','100','PDF'])assert.ok(prepared.review.includes(value));
 assert.equal(prepared.humanApprovalEnforced,false);assert.equal(prepared.confirmationRequired,true);assert.ok((await c.requests()).every(r=>!r.write));
 const noEmail=json(await c.call('prepare_morning_action',prepareInput('addDocument')));assert.match(noEmail.review,/ללא שליחה במייל/);
});

test('Review preserves every changed field and masks payment credentials without raw JSON',()=>{
 const text=reviewText({environment:'production',payload:{operationId:'updateClient',body:{name:'Example',bankAccount:'12345',active:false,emails:[],nested:{setting:0,token:'private-token'}},before:{primary:{name:'Previous'}},risk:'change'}});
 for(const value of ['Previous','Example','12345','לא','ללא','0','מוסתרים'])assert.ok(text.includes(value));assert.doesNotMatch(text,/private-token|[{}]/);
});
