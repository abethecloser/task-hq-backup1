// Roof takeoff: measurements typed from a measurement report (or a field measure), one waste
// model, and priced line items whose quantities are typed or come from formulas.
//
// There is no report integration: measurements are entered by a person, and attached reports
// are recorded as metadata only. Pitch is recorded because it explains the waste figure, but it
// never changes waste by itself (no approved rule exists for that).
import type { QuantityResult } from './formula.ts';
import { evaluateAll } from './formula.ts';
import { round2 } from './pricing.ts';

export type MeasureKey = 'totalSq' | 'rakes' | 'valleys' | 'dripEdge' | 'eaves' | 'ridges' | 'hips' | 'lowSlope' | 'leakBarrier';

export const MEASURES: { key: MeasureKey; label: string; unit: string }[] = [
  { key: 'totalSq', label: 'Total SQ', unit: 'SQ' },
  { key: 'rakes', label: 'Rakes', unit: 'FT' },
  { key: 'valleys', label: 'Valleys', unit: 'FT' },
  { key: 'dripEdge', label: 'Drip edge', unit: 'FT' },
  { key: 'eaves', label: 'Eaves', unit: 'FT' },
  { key: 'ridges', label: 'Ridges', unit: 'FT' },
  { key: 'hips', label: 'Hips', unit: 'FT' },
  { key: 'lowSlope', label: 'Low slope', unit: 'SQ FT' },
  { key: 'leakBarrier', label: 'Leak barrier', unit: 'FT' },
];

export interface ReportMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  addedBy: string;
  addedAt: number;
  /** Where the file is. Uploading to shared storage needs approval, so today it's never shared. */
  stored: 'this-browser' | 'not-kept';
}

export interface TakeoffLine {
  id: string;
  group: 'material' | 'labor';
  name: string;
  unit: string;
  /** A formula over measurements and other lines; when empty, `typed` is the quantity. */
  formula: string;
  typed: number | null;
  unitCost: number;
}

export interface Takeoff {
  measurements: Partial<Record<MeasureKey, number | null>>;
  /** Job-level waste percentage, applied to every measurement unless overridden. */
  wastePct: number;
  overrides: Partial<Record<MeasureKey, number>>;
  /** e.g. "6/12". Recorded, never used to compute waste. */
  pitch: string;
  measuredOn: string;
  source: 'report' | 'field' | '';
  reports: ReportMeta[];
  lines: TakeoffLine[];
  /** Optional crew labor: crew × days × hours × rate, added as a labor cost. */
  crew: { size: number; days: number; hours: number; rate: number } | null;
}

export interface LineResult extends QuantityResult { id: string; group: TakeoffLine['group']; unit: string; unitCost: number; amount: number | null }

export interface TakeoffResult {
  base: Record<string, number | null>;
  lines: LineResult[];
  material: number;
  labor: number;
  crewLabor: number;
  manHours: number;
  /** Lines that can't be computed (missing measurement, bad formula, cycle). */
  problems: { id: string; name: string; error: string }[];
  missing: MeasureKey[];
}

export const withWasteLabel = (label: string) => `${label} + waste`;

export function wasteFor(takeoff: Takeoff, key: MeasureKey): number {
  const override = takeoff.overrides[key];
  return typeof override === 'number' && Number.isFinite(override) ? override : takeoff.wastePct;
}

/** The names formulas may refer to: each measurement, and each measurement with its waste. */
export function baseValues(takeoff: Takeoff): Record<string, number | null> {
  const base: Record<string, number | null> = {};
  for (const m of MEASURES) {
    const raw = takeoff.measurements[m.key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    base[m.label] = value;
    base[withWasteLabel(m.label)] = value === null ? null : Math.round(value * (1 + wasteFor(takeoff, m.key) / 100) * 1e9) / 1e9;
  }
  return base;
}

export function computeTakeoff(takeoff: Takeoff): TakeoffResult {
  const base = baseValues(takeoff);
  const quantities = evaluateAll(takeoff.lines.map(line => ({ name: line.name, formula: line.formula, typed: line.typed })), base);
  const lines: LineResult[] = takeoff.lines.map((line, index) => {
    const q = quantities[index]!;
    return { ...q, id: line.id, group: line.group, unit: line.unit, unitCost: line.unitCost, amount: q.value === null ? null : round2(q.value * Math.max(0, line.unitCost)) };
  });
  const sum = (group: TakeoffLine['group']) => round2(lines.filter(line => line.group === group).reduce((total, line) => total + (line.amount ?? 0), 0));
  const crew = takeoff.crew;
  const manHours = crew ? Math.max(0, crew.size) * Math.max(0, crew.days) * Math.max(0, crew.hours) : 0;
  const crewLabor = crew ? round2(manHours * Math.max(0, crew.rate)) : 0;
  const names = new Set<string>();
  const problems = lines.filter(line => line.error && line.error !== 'No quantity yet.').map(line => ({ id: line.id, name: line.name, error: line.error! }));
  for (const line of takeoff.lines) {
    const key = line.name.trim().toLowerCase();
    if (!key) problems.push({ id: line.id, name: '(unnamed)', error: 'Every line needs a name.' });
    else if (names.has(key) || key in Object.fromEntries(Object.keys(base).map(name => [name.toLowerCase(), 1]))) problems.push({ id: line.id, name: line.name, error: 'Another line or a measurement already uses this name.' });
    names.add(key);
  }
  return {
    base, lines, material: sum('material'), labor: round2(sum('labor') + crewLabor), crewLabor, manHours, problems,
    missing: MEASURES.filter(m => typeof takeoff.measurements[m.key] !== 'number').map(m => m.key),
  };
}

/** Tax is a company setting: on material only, or on material and labor lines. */
export function taxFor(result: TakeoffResult, taxPct: number, base: 'material' | 'all'): number {
  const taxable = base === 'material' ? result.material : result.material + result.labor;
  return round2(taxable * Math.max(0, taxPct) / 100);
}
