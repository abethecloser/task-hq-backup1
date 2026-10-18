// Publishes the Task-HQ icons (favicon, extension toolbar and store sizes). They are
// pre-rendered from the real logo in src/assets/brand (icon-16/32/48/128.png, cropped
// from "Task Management OS Logo.png"); this only copies them, with no dependencies.
import { copyFileSync, mkdirSync } from 'node:fs';

const from = new URL('../src/assets/brand/', import.meta.url);
const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) copyFileSync(new URL(`icon-${size}.png`, from), new URL(`icon-${size}.png`, out));
console.log('icons copied to public/icons');
