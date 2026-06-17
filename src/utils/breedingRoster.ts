// Breeding analysis over a real parsed roster: relatedness checks and
// foundation-pair suggestions that feed the Breeding Guide.

import { pairCoverage } from './breeding';
import type { CatStat, PairCoverage } from './breeding';
import type { ParsedCat, Sex } from './catParser';

/** Parent-child or full/half siblings (share at least one parent). */
export function isRelated(a: ParsedCat, b: ParsedCat): boolean {
  if (a.dbKey === b.dbKey) return true;
  if (a.parents.includes(b.dbKey) || b.parents.includes(a.dbKey)) return true;
  return a.parents.some((p) => b.parents.includes(p));
}

/** A cat can breed when it is present in the house (not gone/adventuring). */
export function isAvailable(cat: ParsedCat): boolean {
  return cat.status === 'In House';
}

/** Two sexes can pair when they are opposite, or either is undefined ('?'). */
function sexesCompatible(a: Sex, b: Sex): boolean {
  if (a === '?' || b === '?') return true;
  return a !== b;
}

export interface PairSuggestion {
  a: ParsedCat;
  b: ParsedCat;
  coverage: PairCoverage;
  missing: CatStat[];
  related: boolean;
}

/**
 * Rank candidate breeding pairs by projected 7-coverage at the given room
 * Stimulation. Only available (in-house), sex-compatible, unrelated pairs are
 * suggested. Returns the strongest `limit` pairs.
 */
export function suggestFoundationPairs(cats: ParsedCat[], stimulation: number, limit = 6): PairSuggestion[] {
  const pool = cats.filter(isAvailable);
  const out: PairSuggestion[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (!sexesCompatible(a.sex, b.sex)) continue;
      if (isRelated(a, b)) continue;
      const coverage = pairCoverage(a.baseStats, b.baseStats, stimulation);
      out.push({ a, b, coverage, missing: coverage.missing, related: false });
    }
  }

  out.sort((x, y) => y.coverage.coverage - x.coverage.coverage);
  return out.slice(0, limit);
}

export interface RosterSummary {
  total: number;
  inHouse: number;
  males: number;
  females: number;
  /** Cats whose base-stat sum is in the top tier (≥ this many 7s already). */
  topBreeders: ParsedCat[];
}

export function summarizeRoster(cats: ParsedCat[]): RosterSummary {
  const inHouse = cats.filter(isAvailable);
  const males = cats.filter((c) => c.sex === 'male').length;
  const females = cats.filter((c) => c.sex === 'female').length;
  const sevensOf = (c: ParsedCat) => (Object.values(c.baseStats) as number[]).filter((v) => v >= 7).length;
  const topBreeders = [...inHouse]
    .sort((a, b) => sevensOf(b) - sevensOf(a) || b.baseSum - a.baseSum)
    .slice(0, 8);
  return { total: cats.length, inHouse: inHouse.length, males, females, topBreeders };
}

export function sevensCount(cat: ParsedCat): number {
  return (Object.values(cat.baseStats) as number[]).filter((v) => v >= 7).length;
}
