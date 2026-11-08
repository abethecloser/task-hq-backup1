// A CONTRACT TEST DOUBLE, not an organization and not QuestBase. It exists so the consumer contract in
// org-capabilities.ts can be exercised and demonstrated before QuestBase can provide real configurations
// (QBO initialization is not started there). Every entry says so, and the interface labels it as sample data.
// Never used outside the demo and tests.
import { checkSnapshot } from './org-capabilities.ts';
import type { ContextScope, OrgBrain, OrgProvider } from './org-capabilities.ts';

const NOTE = 'Sample brain for contract testing. Not provided by QuestBase; no model or runtime behind it.';
const brain = (b: Omit<OrgBrain, 'state' | 'stateNote' | 'tools' | 'escalatesTo'> & Partial<Pick<OrgBrain, 'state' | 'stateNote' | 'tools' | 'escalatesTo'>>): OrgBrain => ({ state: 'experimental', stateNote: NOTE, tools: [], escalatesTo: 'the owner', ...b });

export const SAMPLE_ORG: ContextScope = { kind: 'organization', id: 'sample-org', name: 'Sample roofing company' };

const ORG_BRAINS: OrgBrain[] = [
  brain({ id: 'org.oversight', name: 'Organizational Oversight', domain: 'oversight', purpose: 'Keeps the whole operation coherent and escalates to the owner.', responsibilities: ['Cross-department conflicts', 'Owner escalation'], accountable: ['Owner'], ceiling: 'propose', suits: ['general', 'plan', 'decide', 'handoff'] }),
  brain({ id: 'org.finance', name: 'Finance', domain: 'finance', purpose: 'Pricing, invoices, disputes and cash timing.', responsibilities: ['Invoices', 'Disputes', 'Estimates review'], accountable: ['Office manager'], tools: ['Estimating tool'], ceiling: 'prepare', suits: ['estimate', 'communicate'] }),
  brain({ id: 'org.sales', name: 'Sales', domain: 'sales', purpose: 'Leads, quotes and customer follow-up.', responsibilities: ['Lead follow-up', 'Quotes'], accountable: ['Sales lead'], ceiling: 'propose', suits: ['communicate', 'estimate', 'research'] }),
  brain({ id: 'org.production', name: 'Production', domain: 'production', purpose: 'Crews, jobs in progress and materials on site.', responsibilities: ['Crew assignments', 'Job progress'], accountable: ['Production manager'], ceiling: 'propose', suits: ['schedule', 'plan', 'handoff', 'general'] }),
  brain({ id: 'org.scheduling', name: 'Scheduling', domain: 'scheduling', purpose: 'Crew and calendar capacity.', responsibilities: ['Install dates', 'Capacity'], accountable: ['Production manager'], tools: ['Calendar'], ceiling: 'anticipate', suits: ['schedule', 'plan'] }),
  brain({ id: 'org.marketing', name: 'Marketing', domain: 'marketing', purpose: 'Campaigns and lead sources.', responsibilities: ['Campaigns'], accountable: ['Owner'], ceiling: 'observe', suits: ['research', 'communicate'], state: 'unavailable', stateNote: 'Not configured for this organization.' }),
];

const PERSONAL_BRAINS: OrgBrain[] = [
  brain({ id: 'me.focus', name: 'My focus', domain: 'personal planning', purpose: 'Your own priorities and working patterns, independent of any organization.', responsibilities: ['Personal planning'], accountable: ['You'], escalatesTo: 'you', ceiling: 'prepare', suits: ['plan', 'general', 'research', 'decide'] }),
];

/** Same shape QuestBase would return, so the consumer cannot tell the difference except by `source`. */
export const fixtureProvider: OrgProvider = async context => checkSnapshot({ context, source: 'fixture', brains: context.kind === 'personal' ? PERSONAL_BRAINS : context.id === SAMPLE_ORG.id ? ORG_BRAINS : [], fetchedAt: 0 }, context);
