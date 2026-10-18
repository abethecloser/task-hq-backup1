import{test}from'node:test';import assert from'node:assert/strict';
import{validateIntakeEnvelope}from'./intake-validation.ts';import{receiveIntake}from'./intake.ts';
const now=Date.parse('2026-10-17T18:00:00Z');
const valid={version:1,sourceId:'synthetic.manual',externalId:'original-event-1',receivedAt:'2026-10-17T10:00:00-07:00',contact:{name:' Synthetic ',email:'FIXTURE@example.test',phone:'(602) 555-0100'},inquiry:{need:' Synthetic inquiry '}};
test('canonical boundary preserves identity and original instant, normalizes contacts without owner inference',()=>{
 const r=validateIntakeEnvelope(valid,now);assert.equal(r.ok,true);if(r.ok){assert.equal(r.envelope.externalId,valid.externalId);assert.equal(r.envelope.receivedAt,'2026-10-17T17:00:00.000Z');assert.equal(r.envelope.contact.phone,'6025550100');assert.equal(r.envelope.contact.email,'fixture@example.test');assert.equal('orgId'in r.envelope,false);}
});
test('untrusted envelopes reject routing overrides, bad contacts, impossible dates, versions, oversized and missing data',()=>{
 const cases=[null,[],{}, {...valid,version:2},{...valid,orgId:'forged'},{...valid,sourceId:'UPPER.source'},{...valid,contact:{name:'Nobody'}},{...valid,contact:{...valid.contact,email:'invalid'}},{...valid,receivedAt:'2026-02-30T12:00:00Z'},{...valid,receivedAt:'2026-10-17T19:00:00Z'},{...valid,inquiry:{need:'a'.repeat(17000)}}];
 for(const input of cases)assert.equal(validateIntakeEnvelope(input,now).ok,false,JSON.stringify(input).slice(0,100));
});
test('invalid intake cannot reach a backend RPC',async()=>{
 let calls=0;const result=await receiveIntake({rpc:async()=>{calls++;throw Error('must not call');}}, {...valid,orgId:'forged'});
 assert.equal(calls,0);assert.equal(result.ok,false);if(!result.ok)assert.equal(result.code,'invalid');
});
