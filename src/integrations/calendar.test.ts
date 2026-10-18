import{test}from'node:test';import assert from'node:assert/strict';import{normalizeCalendarReferences}from'./calendar.ts';
const scope={orgId:'synthetic-org',sourceId:'synthetic.calendar',synthetic:true};
test('calendar adapter yields Claude existing CalendarFeed from bounded synthetic facts, discarding private metadata',()=>{
 const r=normalizeCalendarReferences({appointments:[{id:'event-1',title:'Synthetic appointment',start:1,end:2,attendees:['private@example.test'],access_token:'do-not-transfer',description:'do-not-transfer'}]},scope);
 assert.equal(r.ok,true);if(r.ok){assert.equal(r.reference.orgId,scope.orgId);assert.equal(r.reference.feed.synthetic,true);assert.equal(r.reference.feed.source,scope.sourceId);assert.deepEqual(Object.keys(r.reference.feed.appointments[0]).sort(),['end','id','start','title']);}
});
test('calendar scope, duplicate identity, invalid times and unbounded batches fail closed',()=>{
 const valid={id:'event-1',title:'Synthetic appointment',start:1,end:2};
 for(const input of [{orgId:'foreign',appointments:[valid]},{appointments:[valid,valid]},{appointments:[{...valid,end:0}]},{appointments:[{...valid,start:Infinity}]},{appointments:Array(101).fill(valid)}])assert.equal(normalizeCalendarReferences(input,scope).ok,false);
});
