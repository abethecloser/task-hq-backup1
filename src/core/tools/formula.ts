// Quantity formulas for takeoff lines, e.g. `ROUNDUP({Total SQ + waste} * 3)`.
//
// Parsed by a small recursive-descent parser and evaluated over a fixed set of functions:
// nothing is ever passed to eval/new Function. References are `{Name}`; names are whatever
// the takeoff exposes (measurements, measurements with waste, and other lines by name).
// Results are snapped to 9 decimals before rounding so float noise (20 × 1.1 =
// 22.000000000000004) never rounds a whole box up.

export type Formula =
  | { k: 'num'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'neg'; a: Formula }
  | { k: 'bin'; op: '+' | '-' | '*' | '/'; a: Formula; b: Formula }
  | { k: 'call'; fn: FnName; args: Formula[] };

const FUNCTIONS = ['ROUNDUP', 'ROUNDDOWN', 'ROUND', 'CEILING', 'FLOOR', 'ABS', 'MIN', 'MAX'] as const;
type FnName = typeof FUNCTIONS[number];
export const FORMULA_FUNCTIONS: readonly string[] = FUNCTIONS;

export class FormulaError extends Error {}

const snap = (value: number) => Math.round(value * 1e9) / 1e9;

export function parseFormula(source: string): Formula {
  let i = 0;
  const text = source;
  const ws = () => { while (i < text.length && /\s/.test(text[i]!)) i += 1; };
  const peek = () => { ws(); return text[i]; };
  const expect = (ch: string) => { if (peek() !== ch) throw new FormulaError(`Expected “${ch}” at position ${i + 1}.`); i += 1; };

  function expr(): Formula {
    let left = term();
    for (let ch = peek(); ch === '+' || ch === '-'; ch = peek()) { i += 1; left = { k: 'bin', op: ch, a: left, b: term() }; }
    return left;
  }
  function term(): Formula {
    let left = unary();
    for (let ch = peek(); ch === '*' || ch === '/'; ch = peek()) { i += 1; left = { k: 'bin', op: ch, a: left, b: unary() }; }
    return left;
  }
  function unary(): Formula {
    if (peek() === '-') { i += 1; return { k: 'neg', a: unary() }; }
    if (peek() === '+') { i += 1; return unary(); }
    return atom();
  }
  function atom(): Formula {
    const ch = peek();
    if (ch === undefined) throw new FormulaError('The formula ends too early.');
    if (ch === '(') { i += 1; const inner = expr(); expect(')'); return inner; }
    if (ch === '{') {
      const close = text.indexOf('}', i);
      if (close < 0) throw new FormulaError('A “{” reference is never closed.');
      const name = text.slice(i + 1, close).trim();
      if (!name) throw new FormulaError('Empty reference “{}”.');
      i = close + 1;
      return { k: 'ref', name };
    }
    const num = /^(\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(i));
    if (num) { i += num[0].length; return { k: 'num', v: Number(num[0]) }; }
    const word = /^[A-Za-z]+/.exec(text.slice(i));
    if (word) {
      const fn = word[0].toUpperCase() as FnName;
      if (!FUNCTIONS.includes(fn)) throw new FormulaError(`“${word[0]}” isn’t a supported function. Use ${FUNCTIONS.join(', ')}.`);
      i += word[0].length;
      expect('(');
      const args: Formula[] = [];
      if (peek() !== ')') { args.push(expr()); while (peek() === ',') { i += 1; args.push(expr()); } }
      expect(')');
      const [min, max] = fn === 'ABS' ? [1, 1] : fn === 'MIN' || fn === 'MAX' ? [1, 20] : [1, 2];
      if (args.length < min || args.length > max) throw new FormulaError(`${fn} takes ${min === max ? min : `${min}–${max}`} argument${max > 1 ? 's' : ''}.`);
      return { k: 'call', fn, args };
    }
    throw new FormulaError(`Unexpected “${ch}” at position ${i + 1}.`);
  }

  if (!source.trim()) throw new FormulaError('Write a formula or type a quantity.');
  if (source.length > 500) throw new FormulaError('Keep formulas under 500 characters.');
  const tree = expr();
  ws();
  if (i < text.length) throw new FormulaError(`Unexpected “${text[i]}” at position ${i + 1}.`);
  return tree;
}

export function referencesOf(tree: Formula, out = new Set<string>()): Set<string> {
  if (tree.k === 'ref') out.add(tree.name);
  else if (tree.k === 'neg') referencesOf(tree.a, out);
  else if (tree.k === 'bin') { referencesOf(tree.a, out); referencesOf(tree.b, out); }
  else if (tree.k === 'call') tree.args.forEach(arg => referencesOf(arg, out));
  return out;
}

const scale = (digits: number) => 10 ** Math.trunc(digits);

export function evaluate(tree: Formula, lookup: (name: string) => number): number {
  const ev = (node: Formula): number => {
    switch (node.k) {
      case 'num': return node.v;
      case 'ref': return lookup(node.name);
      case 'neg': return -ev(node.a);
      case 'bin': {
        const a = ev(node.a); const b = ev(node.b);
        if (node.op === '/' && b === 0) throw new FormulaError('Division by zero.');
        return node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : a / b;
      }
      case 'call': {
        const args = node.args.map(ev);
        const [x, second] = [snap(args[0]!), args[1]];
        switch (node.fn) {
          case 'ABS': return Math.abs(x);
          case 'MIN': return Math.min(...args);
          case 'MAX': return Math.max(...args);
          case 'ROUND': { const f = scale(second ?? 0); return Math.sign(x) * Math.round(snap(Math.abs(x) * f)) / f; }
          case 'ROUNDUP': { const f = scale(second ?? 0); return Math.sign(x) * Math.ceil(snap(Math.abs(x) * f)) / f; }
          case 'ROUNDDOWN': { const f = scale(second ?? 0); return Math.sign(x) * Math.floor(snap(Math.abs(x) * f)) / f; }
          case 'CEILING': case 'FLOOR': {
            const sig = second ?? 1;
            if (sig === 0) return 0;
            if (sig < 0) throw new FormulaError(`${node.fn} needs a positive multiple.`);
            const q = snap(x / sig);
            return (node.fn === 'CEILING' ? Math.ceil(q) : Math.floor(q)) * sig;
          }
        }
      }
    }
  };
  const value = ev(tree);
  if (!Number.isFinite(value)) throw new FormulaError('The result isn’t a finite number.');
  return snap(value);
}

/** One named quantity: a typed value or a formula. */
export interface QuantityInput { name: string; typed?: number | null; formula?: string }
export type QuantityResult = { name: string; value: number | null; error: string | null };

/**
 * Evaluates named quantities that may refer to fixed `base` values and to each other.
 * Order doesn't matter; cycles and unknown names are reported per line, never thrown.
 */
export function evaluateAll(inputs: QuantityInput[], base: Record<string, number | null>): QuantityResult[] {
  const byName = new Map(inputs.map(item => [item.name.trim().toLowerCase(), item]));
  const baseLower = new Map(Object.entries(base).map(([key, value]) => [key.trim().toLowerCase(), value]));
  const results = new Map<string, QuantityResult>();
  const visiting = new Set<string>();

  function resolve(key: string, from: string): number {
    if (baseLower.has(key)) {
      const value = baseLower.get(key);
      if (value === null || value === undefined) throw new FormulaError(`“${key}” hasn’t been measured yet.`);
      return value;
    }
    const item = byName.get(key);
    if (!item) throw new FormulaError(`Nothing called “${key}” in this takeoff.`);
    if (visiting.has(key)) throw new FormulaError(`“${from}” and “${item.name}” refer to each other.`);
    const result = run(key, item);
    if (result.value === null) throw new FormulaError(`“${item.name}” has a problem: ${result.error}`);
    return result.value;
  }
  function run(key: string, item: QuantityInput): QuantityResult {
    const done = results.get(key);
    if (done) return done;
    visiting.add(key);
    let result: QuantityResult;
    try {
      if (item.formula && item.formula.trim()) {
        const tree = parseFormula(item.formula);
        result = { name: item.name, value: evaluate(tree, name => resolve(name.toLowerCase(), item.name)), error: null };
      } else if (typeof item.typed === 'number' && Number.isFinite(item.typed)) {
        result = { name: item.name, value: item.typed, error: null };
      } else {
        result = { name: item.name, value: null, error: 'No quantity yet.' };
      }
    } catch (error) {
      result = { name: item.name, value: null, error: error instanceof Error ? error.message : String(error) };
    }
    visiting.delete(key);
    results.set(key, result);
    return result;
  }
  return inputs.map(item => run(item.name.trim().toLowerCase(), item));
}
