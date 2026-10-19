// Universal command input: deterministic parsing of natural task text into reviewable
// drafts, plus caret autocomplete. Pure and local: no network, nothing changes until the
// person reviews the drafts and creates them through the engine.
//
//   @Name        a person (members first; staged people are recognized but never assignable)
//   #tag         a tag (known tags suggested; new tags are flagged)
//   /type        a task type, only from the organization's configured types
//   !high !!     priority (also "high priority", "urgent", "asap")
//   dates/times  today, tomorrow, friday, next monday, in 3 days, 10/24, Oct 24, 2026-10-24,
//                at 9am, 9:30, 14:00, noon
//   then …       a following task that depends on the previous one
//   assign … to Name / ask Name to … / owner Name     a PROPOSED owner (needs confirmation)
//   review by Name / approval from Name               a PROPOSED approver (review point)
// A mention alone ("with @Maya") is never an assignment: it only adds a watcher.
import type { ReferenceDocument } from './references.ts';
import type { NewTask, Person, QuestState } from './contract.ts';
import { canonicalTag, projectReferences, referenceDocument, referenceScope, referenceSuggestions } from './references.ts';
import { addDays, localDate } from './time.ts';

export interface StagedPerson { id: string; name: string; email?: string | null }
export interface Directory { members: Person[]; staged: StagedPerson[] }

export type PersonRef =
  | { kind: 'member'; id: string; name: string }
  | { kind: 'staged'; id: string; name: string }
  | { kind: 'ambiguous'; text: string; options: PersonRef[] }
  | { kind: 'unknown'; text: string };

export interface Proposal { ref: PersonRef; from: string; confirmed: boolean }

export interface Draft {
  references?: ReferenceDocument;
  key: string;
  include: boolean;
  /** The words this draft came from. */
  source: string;
  title: string;
  owner: Proposal | null;
  approver: Proposal | null;
  /** Mentioned people: watchers only, never owners. */
  with: PersonRef[];
  due: string;
  dueTime: string;
  /** How the date/time was read, for the person to check. */
  when: string;
  priority: 'normal' | 'high';
  type: string;
  tags: { tag: string; known: boolean }[];
  /** Key of the draft this one starts after ("then …"). */
  after: string | null;
  notes: string[];
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_SHORT: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = 86_400_000;

export function directoryFor(state: QuestState, staged: StagedPerson[] = []): Directory {
  const memberEmails = new Set(state.people.map(item => item.name.toLowerCase()));
  return { members: state.people, staged: staged.filter(item => !memberEmails.has(item.name.toLowerCase())) };
}

// ── People ────────────────────────────────────────────────────────────────

const first = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
const words = (name: string) => name.toLowerCase().split(/\s+/);

/** Resolves a name the way people say it: full name, then first name, then unique prefix. */
export function resolvePerson(dir: Directory, raw: string): PersonRef {
  const text = raw.trim().replace(/[.,;:!?]+$/, '');
  const key = text.toLowerCase();
  const all: PersonRef[] = [
    ...dir.members.filter(item => item.role !== 'reviewer').map(item => ({ kind: 'member' as const, id: item.id, name: item.name })),
    ...dir.staged.map(item => ({ kind: 'staged' as const, id: item.id, name: item.name })),
  ];
  const nameOf = (ref: PersonRef) => (ref.kind === 'member' || ref.kind === 'staged' ? ref.name : '');
  const exact = all.filter(ref => nameOf(ref).toLowerCase() === key);
  if (exact.length === 1) return exact[0]!;
  const byFirst = all.filter(ref => first(nameOf(ref)) === key);
  if (byFirst.length === 1) return byFirst[0]!;
  if (byFirst.length > 1) return { kind: 'ambiguous', text, options: byFirst };
  const byPrefix = all.filter(ref => key.length >= 2 && words(nameOf(ref)).some(part => part.startsWith(key)));
  if (byPrefix.length === 1) return byPrefix[0]!;
  if (byPrefix.length > 1) return { kind: 'ambiguous', text, options: byPrefix };
  return { kind: 'unknown', text };
}

/** "@Alex Morgan" — take the following word as a surname only when it narrows the match. */
function mentionAt(dir: Directory, text: string, index: number): { ref: PersonRef; length: number } {
  const parsed = referenceDocument(text.slice(index), { workspaceId: 'command', people: dir.members, tags: [], canCreateTags: false }).spans.find(s => s.start === 0 && s.kind === 'person');
  if (parsed) { const member = dir.members.find(p => p.id === parsed.id)!; return { ref: { kind: 'member', id: member.id, name: member.name }, length: parsed.end }; }
  const one = /^@([A-Za-z][\w'-]*)/.exec(text.slice(index))!;
  const two = /^@([A-Za-z][\w'-]*)\s+([A-Z][\w'-]*)/.exec(text.slice(index));
  if (two) {
    const full = resolvePerson(dir, `${two[1]} ${two[2]}`);
    if (full.kind === 'member' || full.kind === 'staged') return { ref: full, length: two[0].length };
  }
  return { ref: resolvePerson(dir, one[1]!), length: one[0].length };
}

const sameRef = (a: PersonRef, b: PersonRef) => (a.kind === 'member' || a.kind === 'staged') && (b.kind === 'member' || b.kind === 'staged') ? a.kind === b.kind && a.id === b.id : a.kind === b.kind && 'text' in a && 'text' in b && a.text.toLowerCase() === b.text.toLowerCase();

// ── Dates and times ───────────────────────────────────────────────────────

function dateParts(now: number, offsetDays: number) { return localDate(now + offsetDays * DAY); }

interface When { due: string; time: string; label: string; notes: string[] }

/** Finds date/time phrases, returns what they mean and the text with them removed. */
export function readWhen(input: string, now: number): { when: When; rest: string } {
  let text = ` ${input} `;
  const when: When = { due: '', time: '', label: '', notes: [] };
  const today = new Date(now);
  const take = (pattern: RegExp, handle: (m: RegExpExecArray) => void) => {
    const m = pattern.exec(text);
    if (m) { handle(m); text = text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length); }
  };
  const setDue = (date: string, label: string) => { if (!when.due) { when.due = date; when.label = label; } };

  take(/\b(?:by |on |due )?(today|tonight|eod)\b/i, m => { setDue(dateParts(now, 0), m[1]!.toLowerCase() === 'tonight' ? 'tonight' : 'today'); if (m[1]!.toLowerCase() === 'tonight' && !when.time) when.time = '18:00'; });
  take(/\b(?:by |on |due )?(?:the )?day after tomorrow\b/i, () => setDue(dateParts(now, 2), 'day after tomorrow'));
  take(/\b(?:by |on |due )?(tomorrow|tmrw|tmr)\b/i, () => setDue(dateParts(now, 1), 'tomorrow'));
  take(/\b(?:by |on |due )?in (\d{1,2}) (day|days|week|weeks)\b/i, m => { const n = Number(m[1]); setDue(dateParts(now, /week/i.test(m[2]!) ? n * 7 : n), `in ${n} ${m[2]}`); });
  take(/\b(?:by |on |due )?next week\b/i, () => { const offset = ((1 - today.getDay() + 7) % 7) || 7; setDue(dateParts(now, offset), 'next Monday'); });
  take(/\b(?:by |on |due )?(next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/i, m => {
    const name = m[2]!.toLowerCase();
    const target = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : WEEKDAY_SHORT[name]!;
    let offset = (target - today.getDay() + 7) % 7;
    if (offset === 0) offset = 7;
    const date = dateParts(now, offset);
    setDue(date, `${m[1] ?? ''}${WEEKDAYS[target]}`.trim());
    if (m[1]?.trim().toLowerCase() === 'next') when.notes.push(`“next ${WEEKDAYS[target]}” read as the coming one (${date}).`);
  });
  take(/\b(?:by |on |due )?(\d{4})-(\d{2})-(\d{2})\b/, m => setDue(`${m[1]}-${m[2]}-${m[3]}`, `${m[1]}-${m[2]}-${m[3]}`));
  take(/\b(?:by |on |due )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, m => {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : upcomingYear(today, Number(m[1]) - 1, Number(m[2]));
    setDue(iso(year, Number(m[1]), Number(m[2])), `${m[1]}/${m[2]}`);
  });
  take(/\b(?:by |on |due )?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/i, m => {
    const month = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    setDue(iso(upcomingYear(today, month, Number(m[2])), month + 1, Number(m[2])), `${m[1]} ${m[2]}`);
  });
  take(/\b(?:at )?noon\b/i, () => { when.time = '12:00'; });
  take(/\b(?:at )?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)/i, m => { when.time = clock(Number(m[1]), Number(m[2] ?? 0), m[3]!.toLowerCase().startsWith('p')); });
  take(/\bat (\d{1,2}):(\d{2})\b/i, m => { when.time = clock24(Number(m[1]), Number(m[2]), when.notes); });
  take(/\bat (\d{1,2})\b(?!\/)/i, m => { when.time = clock24(Number(m[1]), 0, when.notes); });
  if (when.time && !when.due) { when.due = dateParts(now, 0); when.label = 'today'; when.notes.push('A time with no date was read as today.'); }
  if (when.due && when.due < localDate(now)) when.notes.push(`${when.due} is in the past.`);
  return { when, rest: text.replace(/\s+/g, ' ').trim() };
}

function upcomingYear(today: Date, month: number, day: number) {
  const candidate = new Date(today.getFullYear(), month, day);
  return candidate.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() ? today.getFullYear() + 1 : today.getFullYear();
}
const pad = (value: number) => String(value).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const clock = (h: number, min: number, pm: boolean) => `${pad((h % 12) + (pm ? 12 : 0))}:${pad(min)}`;
/** "at 3" during the working day means 3pm; 7–11 mean morning. */
function clock24(h: number, min: number, notes: string[]) {
  if (h >= 13 && h <= 23) return `${pad(h)}:${pad(min)}`;
  if (h >= 1 && h <= 6) { notes.push(`“${h}” read as ${h}pm.`); return `${pad(h + 12)}:${pad(min)}`; }
  return `${pad(h)}:${pad(min)}`;
}

// ── Clauses → drafts ──────────────────────────────────────────────────────

/** Splits planning text into task clauses; "then" makes a clause depend on the previous one. */
export function splitClauses(input: string): { text: string; then: boolean }[] {
  const lines = input.split(/\n+|;\s*|(?<=[.!?])\s+(?=[A-Z@#/])/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  const out: { text: string; then: boolean }[] = [];
  for (const line of lines) {
    const parts = line.split(/,?\s+(?:and then|then|after that|afterwards)\s+/i);
    parts.forEach((part, index) => { const text = part.replace(/^(?:and then|then|after that)\s+/i, '').trim(); if (text) out.push({ text, then: index > 0 || /^(?:then|after that)\b/i.test(part) }); });
  }
  return out;
}

const HIGH = /(?:^|\s)(?:!high|!h|!!|!urgent)\b|(?:^|\s)!!(?=\s|$)|\b(?:high priority|top priority|urgent|asap|important)\b/i;
const NORMAL = /(?:^|\s)(?:!normal|!low|!n)\b|\b(?:low priority|normal priority|no rush)\b/i;
const NAME = String.raw`@?(?<name>[A-Za-z][\w'-]*(?: [A-Z][\w'-]*)?)`;
/** Explicit assignment phrases. `keep` is what stays in the title (the object, or the verb phrase). */
const OWNER_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:assign(?:ed)?|give|hand)(?<keep>(?: (?:it|this|that|the [\w -]+?))?) to ${NAME}`, 'i'),
  new RegExp(String.raw`\b(?:ask|have|get) ${NAME} to\b(?<keep>)`, 'i'),
  new RegExp(String.raw`\bowner:? ${NAME}(?<keep>)`, 'i'),
  new RegExp(String.raw`\bfor @(?<name>[A-Za-z][\w'-]*(?: [A-Z][\w'-]*)?)(?<keep>)`, 'i'),
];
const APPROVER_PATTERNS: RegExp[] = [
  /\b(?:review(?:ed)?|approv(?:al|ed)|sign[- ]off)(?: needed)? (?:by|from) @?([A-Za-z][\w'-]*(?: [A-Z][\w'-]*)?)/i,
  /\b@?([A-Za-z][\w'-]*) (?:to )?(?:approves?|signs? off)\b/i,
];

/** `single` reads the whole input as one task (e.g. a chat message turned into a task). */
export function parseCommand(input: string, state: QuestState, now: number, staged: StagedPerson[] = [], options: { single?: boolean; documents?: ReferenceDocument[] } = {}): Draft[] {
  const dir = directoryFor(state, staged);
  const taxonomy = state.taxonomy ?? { types: [], tags: [] };
  const clauses = options.single ? [{ text: input.replace(/\s+/g, ' ').trim(), then: false }].filter(item => item.text) : splitClauses(input);
  const drafts: Draft[] = [];
  clauses.forEach((clause, index) => {
    const notes: string[] = [];
    let text = clause.text;
    // Proposed owner / approver from explicit phrases. Plain names count only here.
    let owner: Proposal | null = null; let approver: Proposal | null = null;
    for (const pattern of OWNER_PATTERNS) {
      const m = pattern.exec(text);
      if (!m) continue;
      const ref = resolvePerson(dir, m.groups!.name!);
      if (ref.kind === 'unknown' && !m[0].includes('@')) continue;   // "assign the roof to Smith residence" isn't a person
      owner = { ref, from: m[0].trim(), confirmed: false };
      text = text.replace(m[0], ` ${m.groups!.keep ?? ''} `);
      break;
    }
    for (const pattern of APPROVER_PATTERNS) {
      const m = pattern.exec(text);
      if (!m) continue;
      const ref = resolvePerson(dir, m[1]!);
      if (ref.kind === 'unknown') continue;
      approver = { ref, from: m[0].trim(), confirmed: false };
      text = text.replace(m[0], ' ');
      break;
    }
    // Mentions → watchers ("with @Maya"); duplicates collapse.
    const withRefs: PersonRef[] = [];
    let cleaned = '';
    for (let i = 0; i < text.length;) {
      if (text[i] === '@' && /[A-Za-z]/.test(text[i + 1] ?? '')) {
        const { ref, length } = mentionAt(dir, text, i);
        const isOwner = owner && sameRef(owner.ref, ref);
        if (!isOwner && !withRefs.some(item => sameRef(item, ref))) withRefs.push(ref);
        if (isOwner || withRefs.filter(item => sameRef(item, ref)).length) cleaned += ref.kind === 'member' || ref.kind === 'staged' ? `@${ref.name}` : text.slice(i, i + length);
        i += length;
      } else { cleaned += text[i]; i += 1; }
    }
    text = cleaned;
    // Priority.
    let priority: 'normal' | 'high' = 'normal';
    if (HIGH.test(text)) { priority = 'high'; text = text.replace(new RegExp(HIGH.source, 'gi'), ' '); }
    else if (NORMAL.test(text)) { if (/low/i.test(text)) notes.push('Task-HQ has Normal and High only; “low” is Normal.'); text = text.replace(new RegExp(NORMAL.source, 'gi'), ' '); }
    // Tags.
    const tags: Draft['tags'] = [];
    text = text.replace(/(^|\s)#([A-Za-z0-9][\w-]{0,29})/g, (_, lead: string, raw: string) => {
      const tag = canonicalTag(raw, { tags: taxonomy.tags, aliases: taxonomy.tagAliases }) ?? raw.toLowerCase();
      if (!tags.some(item => item.tag === tag)) tags.push({ tag, known: taxonomy.tags.includes(tag) });
      return lead;
    });
    // Type: /command, else a configured keyword (earliest in the text wins).
    let type = '';
    text = text.replace(/(^|\s)\/([a-z][\w-]*)/gi, (whole, lead: string, raw: string) => {
      const found = taxonomy.types.find(item => item.id === raw.toLowerCase() || item.label.toLowerCase() === raw.toLowerCase());
      if (found) { type = found.id; return lead; }
      notes.push(`“/${raw}” isn’t a task type here.`);
      return whole;
    });
    if (!type) {
      let best = Infinity;
      for (const item of taxonomy.types) for (const word of item.keywords) {
        const at = text.toLowerCase().search(new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`));
        if (at >= 0 && at < best) { best = at; type = item.id; }
      }
    }
    // Dates and times.
    const { when, rest } = readWhen(text, now);
    notes.push(...when.notes);
    text = rest;
    // Title.
    let title = text.replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,.;:–-]+|[\s,.;:–-]+$/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').replace(/\s*,\s*$/, '');
    title = title.replace(/^(?:please |pls |we need to |need to |i need to |let'?s |remember to )/i, '');
    const previous = drafts[drafts.length - 1];
    if ((!title || /^(?:the |a )?(?:follow[- ]?up|it|this|that)$/i.test(title)) && previous) {
      title = `Follow up: ${previous.title}`;
      if (!type) type = taxonomy.types.find(item => item.id === 'follow-up' || item.keywords.includes('follow-up'))?.id ?? '';
    }
    if (!title) title = 'New task';
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (title.length > 160) { title = title.slice(0, 157) + '…'; notes.push('The name was shortened to 160 characters.'); }
    for (const proposal of [owner, approver]) {
      const ref = proposal?.ref;
      if (ref?.kind === 'staged') notes.push(`${ref.name} isn’t invited yet, so they can’t own or approve work.`);
      if (ref?.kind === 'ambiguous') notes.push(`“${ref.text}” could be ${ref.options.map(item => ('name' in item ? item.name : '')).join(' or ')}.`);
      if (ref?.kind === 'unknown') notes.push(`Nobody called “${ref.text}” is in this workspace.`);
    }
    for (const ref of withRefs) {
      if (ref.kind === 'ambiguous') notes.push(`“@${ref.text}” could be ${ref.options.map(item => ('name' in item ? item.name : '')).join(' or ')}.`);
      if (ref.kind === 'unknown') notes.push(`Nobody called “@${ref.text}” is in this workspace.`);
    }
    drafts.push({
      references: projectReferences([...(options.documents ?? [])].reverse().find(d => d.text === input) ?? referenceDocument(input, referenceScope(state, state.people[0]?.id ?? '')), title, referenceScope(state, state.people[0]?.id ?? '')),
      key: `d${index + 1}`, include: true, source: clause.text, title, owner, approver, with: withRefs,
      due: when.due, dueTime: when.time, when: [when.label, when.time].filter(Boolean).join(' at '),
      priority, type, tags, after: clause.then && previous ? previous.key : null, notes,
    });
  });
  return drafts;
}

/** The engine action input for one reviewed draft. Proposals count only once confirmed. */
export function newTaskFrom(draft: Draft, createdIds: Record<string, string>, opts: { taxonomy: boolean }): NewTask {
  const person = (proposal: Proposal | null) => (proposal?.confirmed && proposal.ref.kind === 'member' ? proposal.ref.id : '');
  const watchers: string[] = []; // A mention links an identity; it never subscribes anyone to task notifications.
  return {
    title: draft.title.trim(),
    owner: person(draft.owner),
    approver: person(draft.approver),
    watchers,
    due: draft.due,
    priority: draft.priority,
    dependsOn: draft.after && createdIds[draft.after] ? [createdIds[draft.after]!] : [],
    ...(opts.taxonomy ? { type: draft.type || undefined, tags: draft.tags.map(item => item.tag), dueTime: draft.due ? draft.dueTime || undefined : undefined } : {}),
  };
}

// ── Autocomplete at the caret ─────────────────────────────────────────────

export type Suggestion =
  | { kind: 'person'; id: string; label: string; detail: string; insert: string; disabled?: boolean }
  | { kind: 'tag'; label: string; detail: string; insert: string }
  | { kind: 'type'; label: string; detail: string; insert: string }
  | { kind: 'priority'; label: string; detail: string; insert: string };

export interface SuggestState { trigger: '@' | '#' | '/' | '!'; query: string; start: number; end: number; items: Suggestion[] }

export function suggestAt(text: string, caret: number, state: QuestState, staged: StagedPerson[] = []): SuggestState | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)([@#/!])([\w'-]*(?: [A-Z][\w'-]*)?)$/.exec(before);
  if (!m) return null;
  const trigger = m[1] as SuggestState['trigger'];
  const query = m[2]!.toLowerCase();
  const start = caret - m[2]!.length - 1;
  const dir = directoryFor(state, staged);
  let items: Suggestion[] = [];
  if (trigger === '@' || trigger === '#') {
    const shared = referenceSuggestions(text, caret, referenceScope(state, state.people[0]?.id ?? ''));
    if (!shared) return null;
    items = shared.items.map(item => item.kind === 'person' ? { ...item, label: item.label.slice(1) } : item);
  } else if (trigger === '/') {
    items = (state.taxonomy?.types ?? []).filter(item => item.id.startsWith(query) || item.label.toLowerCase().startsWith(query)).map(item => ({ kind: 'type' as const, label: `/${item.id}`, detail: item.label, insert: `/${item.id} ` }));
  } else {
    items = [{ kind: 'priority' as const, label: '!high', detail: 'High priority', insert: '!high ' }, { kind: 'priority' as const, label: '!normal', detail: 'Normal priority', insert: '!normal ' }].filter(item => item.label.slice(1).startsWith(query));
  }
  return items.length ? { trigger, query, start, end: caret, items: items.slice(0, 8) } : null;
}

/** Due date label for chips: "Today", "Tomorrow", "Fri Oct 24". */
export function dueLabel(due: string, time: string, now: number) {
  if (!due) return 'No date';
  const day = due === localDate(now) ? 'Today' : due === addDays(now, 1) ? 'Tomorrow' : new Date(`${due}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (!time) return day;
  const [h, m] = time.split(':').map(Number);
  return `${day} · ${((h! + 11) % 12) + 1}${m ? `:${pad(m!)}` : ''}${h! < 12 ? 'am' : 'pm'}`;
}
