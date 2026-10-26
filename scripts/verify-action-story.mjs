import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { seedState, blankTask } from '../src/core/seed.ts';
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error' });
try {
  const { ResponsibilityCard, TaskPage } = await server.ssrLoadModule('/src/app/TaskPage.tsx');
  const now = Date.now(), state = seedState(now);
  state.people.forEach(p => { p.authority = p.id === 'jordan' ? 'admin' : 'member'; });
  const task = blankTask('story-check', {title:'Confirm roof access',owner:'alex',nextAction:'Call the site manager to confirm access',approver:'maya'}, 'jordan', now);
  state.tasks.push(task);
  const quest = actor => ({state,actor,now,backend:{kind:'local',supports:{}},dispatch:()=>{throw Error('Render must not dispatch');}});
  const render = (actor, component = ResponsibilityCard) => renderToStaticMarkup(createElement(component,{quest:quest(actor),task,onOpen:()=>{},onClose:()=>{},onCreate:()=>{},canCreate:true}));
  assert.match(render('alex'),/Your turn/);
  assert.match(render('sam'),/Waiting on Alex Morgan/);
  task.status='review';
  assert.match(render('maya'),/Your turn/);
  assert.match(render('sam'),/Waiting on Maya Chen/);
  assert.doesNotMatch(render('sam'),/Approve &amp; complete/);
  assert.match(render('maya'),/Approve &amp; complete/);
  assert.match(render('jordan'),/Approve &amp; complete/);
  assert.match(render('jordan'),/Approver: Maya Chen/);
  task.approver=''; task.status='working';
  assert.match(render('alex'),/Next handoff not assigned/);
  assert.match(render('alex'),/What to do/);
  assert.match(render('alex',TaskPage),/Optional · no approver set/);
  task.status='done'; task.completedAt=now;
  assert.match(render('alex'),/Completion actor unavailable/);
  assert.match(render('alex'),/Completed/);
  task.status='blocked'; task.blocker={note:'Access code missing',helper:'maya',by:'alex',at:now};
  assert.match(render('alex'),/Waiting on Maya Chen/);
  assert.match(render('maya'),/Your turn/);
  task.status='working'; task.blocker=null;
  const page=render('alex',TaskPage);
  assert.equal((page.match(/Who acts next/g)||[]).length,1);
  // Advanced routing and the lifecycle reference stay available, but under "More details".
  assert.match(page,/<summary>More details/);
  assert.match(page,/Advanced routing/);
  assert.match(page,/Next-step owner/);
  assert.match(page,/Lifecycle reference/);
  assert.doesNotMatch(render('alex'),/Lifecycle reference/, 'the action card no longer carries the lifecycle strip');
  // A person who cannot edit still sees who the approver and next-step owner are, as plain text.
  task.approver='maya'; task.nextOwner='riley';
  const readOnly=render('sam',TaskPage);
  assert.match(readOnly,/Advanced routing/);
  assert.match(readOnly,/Maya Chen/);
  assert.match(readOnly,/Riley Brooks/);
  task.approver=''; task.nextOwner='';
  assert.doesNotMatch(page,/Quick actions/);
  // Build the harness separately into the existing local dist folder. No srcdoc,
  // postMessage listener, extension-message rendering, or nested Vite HTML transforms.
  await build({ configFile:false, plugins:[react()], logLevel:'error', build:{outDir:'dist',emptyOutDir:false,rollupOptions:{input:resolve('scripts/action-story-review.tsx'),output:{entryFileNames:'action-story-review/review.js',assetFileNames:'action-story-review/[name][extname]'}}} });
  writeFileSync('dist/action-story-review.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Task Detail · Action Story review</title><link rel="icon" href="data:,"><link rel="stylesheet" href="./action-story-review/action-story-review.css"></head><body style="margin:0;background:#f5f5f6"><div id="review-root"></div><script type="module" src="./action-story-review/review.js"></script></body></html>');
  console.log('PASS Member/Admin, actual approver, unauthorized review, unassigned handoff, optional approval, completion provenance, blocker helper and single task-detail story');
} finally { await server.close(); }
