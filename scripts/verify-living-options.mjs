import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { livingLayout } from '../src/core/living.ts';
import { seedState } from '../src/core/seed.ts';
const server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, logLevel: 'error' });
try {
  const { LivingGraphic } = await server.ssrLoadModule('/src/app/LivingGraphic.tsx');
  const state = seedState(Date.now());
  const bubbles = livingLayout(state, 'alex', Date.now(), true).bubbles;
  assert.ok(bubbles.length);
  for (const mode of ['radial']) {
    for (const rows of [bubbles, bubbles.slice(0, 1)]) {
      const html = renderToStaticMarkup(createElement(LivingGraphic, { bubbles: rows, active: null, person: null, picked: null, onProject() {}, onTask() {} }));
      assert.doesNotMatch(html, /NaN|Infinity|lv-skin/);
      for (const row of rows) for (const dot of row.dots) assert.ok(html.includes(dot.id) || html.includes(dot.title.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#x27;')), dot.title);
      assert.match(html, /role="button"/);
      assert.match(html, /tabindex="0"/);
    }
  }
  console.log('PASS radial Living graphic render real tasks with keyboard controls, valid geometry, and single-project support; old graphic absent');
} finally { await server.close(); }
