// Companies: the Quest businesses a task can belong to (Roofing, Drafting, Lumen). There is no
// company field on tasks; membership is inferred from what the task is already tagged with, so
// work fills in automatically wherever a company is named:
//   1. the workspace it lives in (name or preset — every task in Quest Roofing is Roofing work),
//   2. its job (project) name, e.g. "Northside re-roof",
//   3. its #tags (after the workspace's tag aliases), e.g. #lumen,
//   4. its task type.
// A task can belong to more than one company (a drafting tag on a roofing job counts for both).
import type { QuestState, Task } from './contract.ts';

export type CompanyId = 'roofing' | 'drafting' | 'lumen';
export interface Company { id: CompanyId; label: string; words: string[] }

/** Words that name each company. Matched as whole words, case-insensitive. */
export const COMPANIES: Company[] = [
  { id: 'roofing', label: 'Roofing', words: ['roofing', 'roof', 'reroof'] },
  { id: 'drafting', label: 'Drafting', words: ['drafting', 'draft'] },
  { id: 'lumen', label: 'Lumen', words: ['lumen'] },
];

const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const names = (text: string, company: Company) => words(text).some(word => company.words.includes(word));

/** Companies the whole workspace belongs to (from its name or preset). */
export function workspaceCompanies(state: Pick<QuestState, 'workspace'>): Set<CompanyId> {
  const found = new Set<CompanyId>();
  for (const company of COMPANIES) {
    if (names(state.workspace?.name ?? '', company) || state.workspace?.preset === company.id) found.add(company.id);
  }
  return found;
}

/** Every company this task belongs to, from its workspace, job, tags and type. */
export function companiesOf(state: QuestState, task: Task, inWorkspace = workspaceCompanies(state)): Set<CompanyId> {
  const found = new Set(inWorkspace);
  const project = state.projects.find(item => item.id === task.projectId)?.name ?? '';
  const aliases = state.taxonomy?.tagAliases ?? {};
  const tags = (task.tags ?? []).map(tag => aliases[tag] ?? tag);
  const type = task.type ? `${task.type} ${state.taxonomy?.types.find(item => item.id === task.type)?.label ?? ''}` : '';
  for (const company of COMPANIES) {
    if (found.has(company.id)) continue;
    if (names(project, company) || tags.some(tag => names(tag, company)) || names(type, company)) found.add(company.id);
  }
  return found;
}

export const companyLabel = (id: string) => COMPANIES.find(item => item.id === id)?.label ?? id;
