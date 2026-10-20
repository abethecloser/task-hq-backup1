// Set a new password for the QA account only, through the Supabase Auth Admin API, without sending email.
// Run it yourself in a terminal: `node scripts/qa-set-password.mjs`
//
// - Works on exactly one user (QA_ID + QA_EMAIL below) and refuses anything else.
// - Asks for the service-role (secret) key and the new password with hidden input. Neither is printed,
//   logged, written to disk or passed on the command line; they live only in this process's memory.
// - Changes only the password. Email, confirmation, MFA, roles and memberships are untouched.
// - Then signs in as the QA user with the public key and checks the Member / Field experience.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const PROJECT = 'xthyyxnfjaxmtrqrhyxc';
const QA_ID = 'cb2bd744-a94a-4076-8bb7-35853026f84f';
const QA_EMAIL = 'qa.prototype.33@gmail.com';
const QUEST_ORG = '492f0048-85ad-4f38-aef7-9b8e7f823cff';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(line => /^[A-Z_]+=/.test(line))
  .map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
const url = env.VITE_SUPABASE_URL;
const publishable = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const fail = message => { console.error(`✖ ${message}`); process.exit(1); };
if (new URL(url).hostname !== `${PROJECT}.supabase.co`) fail('This script only runs against the Task-HQ project.');
if (!publishable || publishable.startsWith('sb_secret_')) fail('.env.local must hold the publishable key, not a secret key.');

/** Read a line without echoing it. */
function hidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) { reject(new Error('Run this in an interactive terminal so input can stay hidden.')); return; }
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(value); return; }
        if (char === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

const ask = prompt => hidden(prompt).catch(error => fail(error.message));

const secret = (await ask('Service-role (secret) key, from Supabase → Project Settings → API Keys (hidden): ')).trim();
if (!secret) fail('No key entered. Nothing changed.');
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// The target must be exactly the QA account, as it is today.
const { data: found, error: lookupError } = await admin.auth.admin.getUserById(QA_ID);
if (lookupError || !found?.user) fail(`Couldn't read the QA user with that key (${lookupError?.status ?? 'no user'}). Nothing changed.`);
const qa = found.user;
if (qa.email?.toLowerCase() !== QA_EMAIL) fail('That user id does not belong to the QA address. Nothing changed.');
if (!qa.email_confirmed_at) fail('The QA email is not confirmed. Nothing changed.');
const { data: factors } = await admin.auth.admin.mfa.listFactors({ userId: QA_ID });
console.log(`✔ Target: ${QA_EMAIL} (confirmed, ${factors?.factors?.length ?? 0} MFA factor(s), left as they are)`);

const password = await ask('New QA password, at least 12 characters (hidden): ');
if (password.length < 12) fail('Use at least 12 characters. Nothing changed.');
if ((await ask('Repeat it (hidden): ')) !== password) fail('The two entries differ. Nothing changed.');

const { error: updateError } = await admin.auth.admin.updateUserById(QA_ID, { password });
if (updateError) fail(`Password not changed: ${updateError.message}`);
console.log('✔ Password changed through the Auth Admin API. No email was requested.');

// Verify as the QA user, with the public key only.
const user = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: signedIn, error: signInError } = await user.auth.signInWithPassword({ email: QA_EMAIL, password });
if (signInError || !signedIn.session) fail(`Sign-in check failed: ${signInError?.message ?? 'no session'}`);
console.log('✔ Signs in with the new password');

const { data: memberships } = await user.from('memberships').select('org_id, role, work_role');
const quest = memberships?.find(row => row.org_id === QUEST_ORG);
console.log(quest?.role === 'member' && quest.work_role === 'field' ? '✔ Quest Roofing membership: Member / Field' : `✖ Unexpected membership: ${JSON.stringify(memberships)}`);

const { data: navigation } = await user.rpc('my_navigation');
const reopened = navigation?.by_org?.[QUEST_ORG] ?? [];
console.log(navigation && navigation.full === false ? `✔ Navigation: standard (temporary restrictions apply; reopened for this role: ${reopened.length ? reopened.join(', ') : 'none'})` : '✖ Unexpected navigation answer');

const response = await fetch(`${url}/functions/v1/dispatch`, { method: 'POST', headers: { Authorization: `Bearer ${signedIn.session.access_token}`, apikey: publishable, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'load', orgId: QUEST_ORG }) });
const loaded = await response.json().catch(() => null);
const me = loaded?.state?.people?.find(person => person.id === QA_ID);
console.log(response.ok && me?.authority === 'member' && me.role === 'field'
  ? '✔ Workspace loads; server authority: Member, work role: Field (no Manage workspace)'
  : `✖ Workspace check: HTTP ${response.status}, authority ${me?.authority ?? 'missing'}`);

await user.auth.signOut();
console.log('Done. Sign in at https://task-hq-three.vercel.app to see it in the browser.');
