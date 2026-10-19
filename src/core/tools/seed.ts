// Synthetic tool settings and sample records for the demo workspace.
//
// Every number and sentence here is a placeholder chosen for this prototype. None of it is a
// company's real pricing, tiers, product list or contract wording; a workspace replaces these in
// Tools → Settings, and proposals say "sample wording" until the company approves its own.
// The pricing formula starts NOT decided, so nothing can be approved until a manager chooses.
import type { Person } from '../contract.ts';
import type { Estimate, ToolsConfig, ToolsState } from './estimating.ts';
import type { TakeoffLine } from './takeoff.ts';

const line = (id: string, group: TakeoffLine['group'], name: string, unit: string, formula: string, unitCost: number, typed: number | null = null): TakeoffLine =>
  ({ id, group, name, unit, formula, typed, unitCost });

/** A shingle re-roof line set. Quantities come from the measurements; prices are samples. */
export const SAMPLE_LIBRARY: TakeoffLine[] = [
  line('lib-shingles', 'material', 'Architectural shingles', 'bundle', 'ROUNDUP({Total SQ + waste} * 3)', 42),
  line('lib-starter', 'material', 'Starter strip', 'bundle', 'ROUNDUP(({Eaves + waste} + {Rakes + waste}) / 100)', 58),
  line('lib-cap', 'material', 'Hip & ridge cap', 'bundle', 'ROUNDUP(({Ridges + waste} + {Hips + waste}) / 25)', 64),
  line('lib-underlayment', 'material', 'Synthetic underlayment', 'roll', 'ROUNDUP({Total SQ + waste} / 10)', 96),
  line('lib-leak', 'material', 'Leak barrier membrane', 'roll', 'ROUNDUP({Leak barrier + waste} / 66)', 118),
  line('lib-drip', 'material', 'Drip edge metal', '10 ft', 'ROUNDUP({Drip edge + waste} / 10)', 11),
  line('lib-valley', 'material', 'Valley metal', '10 ft', 'ROUNDUP({Valleys + waste} / 10)', 19),
  line('lib-vent', 'material', 'Ridge vent', '4 ft', 'ROUNDUP({Ridges} / 4)', 22),
  line('lib-nails', 'material', 'Coil nails', 'box', 'ROUNDUP({Total SQ + waste} / 16)', 48),
  line('lib-lowslope', 'material', 'Low-slope membrane', 'SQ', 'ROUNDUP({Low slope + waste} / 100, 1)', 165),
  line('lib-tearoff', 'labor', 'Tear-off and haul', 'SQ', '{Total SQ}', 55),
  line('lib-install', 'labor', 'Install', 'SQ', '{Total SQ + waste}', 95),
  line('lib-flashing', 'labor', 'Flashing and details', 'job', '', 450, 1),
];

export function sampleConfig(): ToolsConfig {
  return {
    modules: { takeoff: true, underwriting: true, proposals: true },
    policy: { formula: 'undecided', decidedBy: '', decidedAt: null, note: '', demo: false },
    reviewBand: 2.5,
    allowSelfApproval: false,
    approverRoles: ['manager'],
    tiers: [
      { id: 'standard', label: 'Standard', target: 30, needsSignoff: false },
      { id: 'repeat', label: 'Repeat client', target: 27, needsSignoff: false },
      { id: 'strategic', label: 'Strategic (sign-off)', target: 22, needsSignoff: true },
    ],
    defaults: { overhead: 12, commission: 6, contingency: 3, wastePct: 12, taxPct: 7.25, taxBase: 'material' },
    library: SAMPLE_LIBRARY,
    proposal: {
      numberPrefix: 'P',
      validDays: 21,
      depositPct: 30,
      companyName: 'Your Company Name',
      companyDetails: 'License # · phone · email (set in Tools settings)',
      warranty: 'Sample: workmanship warranty terms go here once the company approves its wording. Manufacturer warranties are provided by the manufacturer.',
      terms: 'Sample: payment terms, change orders, permits, access and cancellation terms go here once the company approves its wording.',
      wordingApproved: false,
      templates: [
        { id: 'shingle', label: 'Shingle roof replacement', trade: 'Roofing', materials: 'Architectural shingles, synthetic underlayment, leak barrier at eaves and valleys, new drip edge and ridge ventilation.', scope: [
          { id: 's1', service: 'Tear-off', description: 'Remove existing roofing down to the deck and haul away debris.', highlight: false },
          { id: 's2', service: 'Deck inspection', description: 'Inspect decking and report any boards that need replacing before install.', highlight: true },
          { id: 's3', service: 'Underlayment & leak barrier', description: 'Install leak barrier at eaves and valleys, synthetic underlayment elsewhere.', highlight: false },
          { id: 's4', service: 'Shingles & ridge', description: 'Install starter, field shingles, hip and ridge cap, and ridge vent.', highlight: false },
          { id: 's5', service: 'Clean-up', description: 'Magnetic sweep and final walkthrough with the homeowner.', highlight: false },
        ] },
        { id: 'tile', label: 'Tile roof re-felt', trade: 'Roofing', materials: 'Existing tile reused where sound; new underlayment, battens and replacement tile as needed.', scope: [
          { id: 't1', service: 'Remove & stack tile', description: 'Lift and stack existing tile on the roof for reuse.', highlight: false },
          { id: 't2', service: 'New underlayment', description: 'Install new underlayment and battens.', highlight: true },
          { id: 't3', service: 'Re-lay tile', description: 'Re-lay tile and replace broken pieces.', highlight: false },
        ] },
        { id: 'flat', label: 'Flat roof — modified bitumen', trade: 'Roofing', materials: 'Base sheet and modified bitumen cap sheet.', scope: [
          { id: 'f1', service: 'Remove existing', description: 'Remove existing flat roofing to the deck.', highlight: false },
          { id: 'f2', service: 'Install system', description: 'Install base sheet and cap sheet, with edge metal.', highlight: true },
        ] },
        { id: 'coating', label: 'Roof coating', trade: 'Roofing', materials: 'Surface preparation and elastomeric coating.', scope: [
          { id: 'c1', service: 'Prepare surface', description: 'Clean and repair the existing surface.', highlight: false },
          { id: 'c2', service: 'Apply coating', description: 'Apply coating to the specified thickness.', highlight: true },
        ] },
        { id: 'gutters', label: 'Seamless gutters', trade: 'Gutters', materials: 'Seamless gutters and downspouts.', scope: [
          { id: 'g1', service: 'Gutters', description: 'Install seamless gutters with hidden hangers.', highlight: false },
          { id: 'g2', service: 'Downspouts', description: 'Install downspouts and splash blocks.', highlight: false },
        ] },
      ],
    },
    sample: true,
  };
}

/** Two sample estimates: one measured and priced, one waiting on measurements. */
export function seedTools(orgId: string, now: number, people: Person[]): ToolsState {
  const config = sampleConfig();
  const pick = (role: Person['role'], fallback = '') => people.find(item => item.role === role)?.id ?? fallback;
  const estimator = pick('estimator', pick('coordinator', people[0]?.id ?? ''));
  const manager = pick('manager');
  const lines = SAMPLE_LIBRARY.map(item => ({ ...item, id: `maple-${item.id}` }));
  const base = (over: Partial<Estimate>): Estimate => ({
    id: '', number: '', title: '', customer: { name: '', phone: '', email: '' }, address: '', trade: 'Roofing', status: 'draft', preparedBy: estimator, approver: manager,
    takeoff: { measurements: {}, wastePct: config.defaults.wastePct, overrides: {}, pitch: '', measuredOn: '', source: '', reports: [], lines: [], crew: null },
    extra: { permits: 0, disposal: 0, other: 0 }, taxPct: config.defaults.taxPct, taxBase: config.defaults.taxBase,
    rates: { overhead: config.defaults.overhead, commission: config.defaults.commission, contingency: config.defaults.contingency },
    tierId: 'standard', target: 30, price: null, approval: null, voided: [], tasks: {}, history: [], createdAt: now, updatedAt: now, ...over,
  });
  const maple = base({
    id: 'est-maple', number: 'E-0001', title: 'Maple Ave re-roof', customer: { name: 'Sample Homeowner A', phone: '(555) 010-0101', email: 'homeowner.a@example.com' },
    address: '1200 Maple Ave (sample)',
    takeoff: {
      measurements: { totalSq: 28, rakes: 160, valleys: 48, dripEdge: 310, eaves: 150, ridges: 62, hips: 0, lowSlope: 0, leakBarrier: 198 },
      wastePct: 12, overrides: { valleys: 15 }, pitch: '6/12', measuredOn: '', source: 'report', reports: [], lines, crew: null,
    },
    extra: { permits: 450, disposal: 600, other: 0 }, price: 21500,
    history: [{ at: now - 3_600_000, by: estimator, text: 'Sample estimate (synthetic data).' }],
  });
  const elm = base({
    id: 'est-elm', number: 'E-0002', title: 'Elm St leak repair and re-roof', customer: { name: 'Sample Homeowner B', phone: '', email: '' },
    address: '48 Elm St (sample)', takeoff: { ...maple.takeoff, measurements: {}, overrides: {}, pitch: '', source: '', lines: SAMPLE_LIBRARY.map(item => ({ ...item, id: `elm-${item.id}` })) },
    approver: '', history: [{ at: now - 1_800_000, by: estimator, text: 'Sample estimate (synthetic data).' }],
  });
  return { version: 1, orgId, config, estimates: [maple, elm], proposals: [], seq: { estimate: 2, proposal: 0 }, log: [] };
}
