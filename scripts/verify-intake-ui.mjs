// Offline component rendering against the existing shared RecordCard UI.
// No browser session, HTTP server, customer records, or backend connection.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { emptyState } from '../supabase/functions/dispatch/logic.ts';
const server=await createServer({server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
  const {LeadCard}=await server.ssrLoadModule('/src/app/SpeedToLead.tsx');
  const org={id:'00000000-0000-4000-8000-000000000001',slug:'synthetic-construction',name:'Synthetic Construction',preset:'general'};
  const owner='00000000-0000-4000-8000-000000000002';
  const now=Date.parse('2026-10-17T18:00:00Z');
  const state=emptyState(org,[{user_id:owner,role:'owner',work_role:'manager',name:'Synthetic owner'}],now);
  const base={id:'synthetic-lead',name:'Synthetic inquiry',source:'synthetic.website',phone:'',email:'fixture@example.test',address:'Synthetic address',need:'Synthetic estimate',arrivedAt:now,assignee:owner,assignedAt:now,firstResponseAt:null,attempts:[],stage:'new',blocker:'',followUpTaskId:'',handoffTaskId:'',escalatedTo:'',simulated:false,updatedAt:now,intake:{version:1,sourceId:'synthetic.website',externalId:'synthetic-delivery-1',channel:'website',sourceUrl:'https://example.test/'}};
  const render=lead=>renderToStaticMarkup(createElement(LeadCard,{quest:{state,actor:owner,now,dispatch:()=>{throw new Error('Rendering must not dispatch');}},lead,onOpen:()=>{},selected:false}));
  const website=render(base);
  assert.match(website,/data-record-kind="intake"/);
  assert.match(website,/Source event: synthetic-delivery-1/);
  assert.match(website,/fixture@example.test/);
  assert.match(website,/website/);
  assert.doesNotMatch(website,/No contact method/);
  console.log('PASS existing RecordCard/RecordMeta renders email-only website intake provenance');
  const call=render({...base,email:'',phone:'+16025550100',intake:{...base.intake,channel:'ai_receptionist',externalId:'synthetic-call-1'}});
  assert.match(call,/ai_receptionist/); assert.match(call,/synthetic-call-1/); assert.match(call,/\+16025550100/);
  console.log('PASS shared receptionist contract renders through the same intake card');
  for(const channel of ['business_email','manual']) {const channelHtml=render({...base,intake:{...base.intake,channel}});assert.ok(channelHtml.includes(channel));}
  console.log('PASS email and manual channels retain provenance in the existing intake card');
  const escaped=render({...base,name:'<script>synthetic</script>',intake:{...base.intake,externalId:'<script>synthetic</script>'}});
  assert.doesNotMatch(escaped,/<script>/); assert.match(escaped,/&lt;script&gt;synthetic&lt;\/script&gt;/);
  state.people[0].role='reviewer';
  const reviewer=render(base);
  assert.doesNotMatch(reviewer,/<form/); assert.match(reviewer,/Source event:/);
  console.log('PASS untrusted source text is escaped and reviewers retain read-only intake cards');
} finally {await server.close();}
