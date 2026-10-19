// Underwriting math: one documented engine.
//
// Every formula here is a "variable-rate" model. Some costs are a share of the selling price
// (overhead, commission, contingency); the rest are direct costs. With v = that share and
// t = target margin, all as fractions:
//
//   variable cost        = price × v
//   total cost           = direct + price × v
//   gross profit         = price − total cost
//   margin               = profit ÷ price
//   margin gap (points)  = margin − target
//   price at target      = direct ÷ (1 − v − t)
//   break-even price     = direct ÷ (1 − v)
//   max direct at target = price × (1 − v − t)        (floored at 0)
//   direct headroom      = max direct at target − direct
//
// The legacy tools disagree on v, and the company has not chosen:
//   'full-burden'      v = overhead + commission + contingency   (legacy native Underwriter)
//   'commission-only'  v = commission                            (legacy Estimate builder)
// The legacy Underwriting Sheet's "burden" base is unverified and is NOT modelled here.
// Until a manager records a choice, the policy is 'undecided': both results are shown side by
// side and nothing can be approved.

export type FormulaPolicy = 'undecided' | 'full-burden' | 'commission-only';
export const FORMULA_LABELS: Record<FormulaPolicy, string> = {
  undecided: 'Not decided',
  'full-burden': 'Full burden (overhead + commission + contingency)',
  'commission-only': 'Commission only',
};

export interface DirectCosts { material: number; tax: number; labor: number; permits: number; disposal: number; other: number }
export interface Rates { overhead: number; commission: number; contingency: number }

export interface PricingInput {
  direct: DirectCosts;
  /** Percent, 0–100. */
  rates: Rates;
  /** Percent, 0–100. */
  target: number;
  /** Proposed selling price, or null if not priced yet. */
  price: number | null;
}

export type Decision = 'incomplete' | 'meets-target' | 'review' | 'reprice';
export const DECISION_LABELS: Record<Decision, string> = {
  incomplete: 'Not priced yet',
  'meets-target': 'Meets target',
  review: 'Below target, within review band',
  reprice: 'Reprice',
};

export interface PricingResult {
  formula: Exclude<FormulaPolicy, 'undecided'>;
  directTotal: number;
  /** Percent. */
  variableRate: number;
  variableCost: number | null;
  totalCost: number | null;
  grossProfit: number | null;
  /** Percent. */
  margin: number | null;
  /** Percentage points. */
  marginGap: number | null;
  priceAtTarget: number | null;
  breakEven: number | null;
  maxDirectAtTarget: number | null;
  directHeadroom: number | null;
  decision: Decision;
  problems: string[];
}

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
const money = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

export function directTotal(direct: DirectCosts): number {
  return round2(money(direct.material) + money(direct.tax) + money(direct.labor) + money(direct.permits) + money(direct.disposal) + money(direct.other));
}

export function variableRateFor(formula: Exclude<FormulaPolicy, 'undecided'>, rates: Rates): number {
  return formula === 'full-burden' ? pct(rates.overhead) + pct(rates.commission) + pct(rates.contingency) : pct(rates.commission);
}

/**
 * Prices one estimate under one formula. `reviewBand` is how many points below target still
 * counts as "review" rather than "reprice" (a company setting, not a built-in rule).
 */
export function price(input: PricingInput, formula: Exclude<FormulaPolicy, 'undecided'>, reviewBand: number): PricingResult {
  const direct = directTotal(input.direct);
  const vPct = variableRateFor(formula, input.rates);
  const v = vPct / 100; const t = pct(input.target) / 100;
  const problems: string[] = [];
  if (v + t >= 1) problems.push('Rates plus target margin reach 100% or more, so no price can meet the target.');
  if (v >= 1) problems.push('The price-based rates reach 100%, so there is no break-even price.');
  const priceAtTarget = v + t < 1 && direct > 0 ? round2(direct / (1 - v - t)) : null;
  const breakEven = v < 1 && direct > 0 ? round2(direct / (1 - v)) : null;
  const p = input.price !== null && Number.isFinite(input.price) && input.price > 0 ? input.price : null;
  if (direct <= 0) problems.push('No direct costs yet.');
  if (p === null) problems.push('No selling price yet.');
  if (p === null || direct <= 0) {
    return { formula, directTotal: direct, variableRate: vPct, variableCost: null, totalCost: null, grossProfit: null, margin: null, marginGap: null, priceAtTarget, breakEven, maxDirectAtTarget: null, directHeadroom: null, decision: 'incomplete', problems };
  }
  const variableCost = round2(p * v);
  const totalCost = round2(direct + variableCost);
  const grossProfit = round2(p - totalCost);
  const margin = round2((grossProfit / p) * 100);
  const marginGap = round2(margin - pct(input.target));
  const maxDirectAtTarget = round2(Math.max(0, p * (1 - v - t)));
  const directHeadroom = round2(maxDirectAtTarget - direct);
  const decision: Decision = marginGap >= 0 ? 'meets-target' : marginGap >= -Math.abs(reviewBand) ? 'review' : 'reprice';
  return { formula, directTotal: direct, variableRate: vPct, variableCost, totalCost, grossProfit, margin, marginGap, priceAtTarget, breakEven, maxDirectAtTarget, directHeadroom, decision, problems };
}

/** Under an undecided policy both formulas are computed so the decision can be made on real numbers. */
export function priceUnder(policy: FormulaPolicy, input: PricingInput, reviewBand: number): PricingResult[] {
  if (policy === 'undecided') return [price(input, 'full-burden', reviewBand), price(input, 'commission-only', reviewBand)];
  return [price(input, policy, reviewBand)];
}
