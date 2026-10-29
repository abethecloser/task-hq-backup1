// Task checklist, stored in the task's existing description as a trailing markdown block that
// starts with a "Checklist:" header:
//
//   Notes the team wrote…
//
//   Checklist:
//   - [x] Order shingles
//   - [ ] Confirm drop zone
//
// No new task field and no engine change: edits are ordinary `task/update` description changes,
// so the live server, permissions and history already cover them, and older clients still show
// readable text. Only the trailing block is read as a checklist, so notes above keep their
// reference offsets (mentions/tags) when items change.
export interface ChecklistItem { text: string; done: boolean }
export interface SplitDescription { notes: string; items: ChecklistItem[] }

const ITEM = /^- \[( |x|X)\] (.+)$/;
const HEADER = /^checklist:?$/i;
export const MAX_ITEMS = 30;
export const MAX_ITEM_LENGTH = 120;

export function splitChecklist(description: string): SplitDescription {
  const lines = description.replace(/\s+$/, '').split('\n');
  let start = lines.length;
  while (start > 0 && ITEM.test(lines[start - 1]!.trim())) start -= 1;
  // Only a block introduced by the "Checklist:" header is a checklist. A description that merely ends
  // with Markdown checkboxes (written before this feature, or as notes) stays notes, untouched.
  if (start === lines.length || start === 0 || !HEADER.test(lines[start - 1]!.trim())) return { notes: description, items: [] };
  const items = lines.slice(start).map(line => { const match = ITEM.exec(line.trim())!; return { text: match[2]!.trim(), done: match[1] !== ' ' }; });
  return { notes: lines.slice(0, start - 1).join('\n').replace(/\s+$/, ''), items };
}

export function joinChecklist(notes: string, items: ChecklistItem[]): string {
  const body = notes.replace(/\s+$/, '');
  if (!items.length) return body;
  const block = ['Checklist:', ...items.map(item => `- [${item.done ? 'x' : ' '}] ${item.text.replace(/\s+/g, ' ').trim()}`)].join('\n');
  return body ? `${body}\n\n${block}` : block;
}

export const withNotes = (description: string, notes: string) => joinChecklist(notes, splitChecklist(description).items);
export const withItems = (description: string, items: ChecklistItem[]) => joinChecklist(splitChecklist(description).notes, items);
export function addItem(description: string, text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_ITEM_LENGTH);
  const { items } = splitChecklist(description);
  if (!clean || items.length >= MAX_ITEMS) return null;
  return withItems(description, [...items, { text: clean, done: false }]);
}
export const toggleItem = (description: string, index: number) =>
  withItems(description, splitChecklist(description).items.map((item, at) => (at === index ? { ...item, done: !item.done } : item)));
export const removeItem = (description: string, index: number) =>
  withItems(description, splitChecklist(description).items.filter((_, at) => at !== index));
