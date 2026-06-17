// Breeding analysis over a real parsed roster: relatedness checks and
// foundation-pair suggestions that feed the Breeding Guide.

import { pairCoverage, buildGenerations, makeKinship, defectRiskPercent } from './breeding';
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

// `?? []` keeps these safe against cats restored from an older localStorage
// snapshot that predates the lover/hater fields.
const lovers = (c: ParsedCat) => c.loverKeys ?? [];
const haters = (c: ParsedCat) => c.haterKeys ?? [];

/** Either cat hates the other — the game won't reliably breed them. */
export function hatesEachOther(a: ParsedCat, b: ParsedCat): boolean {
  return haters(a).includes(b.dbKey) || haters(b).includes(a.dbKey);
}

/** Both cats list each other as lovers (best breeding reliability). */
export function mutualLovers(a: ParsedCat, b: ParsedCat): boolean {
  return lovers(a).includes(b.dbKey) && lovers(b).includes(a.dbKey);
}

/** True when a cat is in love with someone who isn't the proposed partner. */
function lovesSomeoneElse(cat: ParsedCat, partner: ParsedCat): boolean {
  return lovers(cat).length > 0 && !lovers(cat).includes(partner.dbKey);
}

export interface PairSuggestion {
  a: ParsedCat;
  b: ParsedCat;
  coverage: PairCoverage;
  missing: CatStat[];
  related: boolean;
  /** Offspring coefficient of inbreeding. */
  coi: number;
  /** Combined birth-defect probability (0–100 %), from the game CoI formula. */
  riskPercent: number;
  /** Both cats already love each other — breeds reliably. */
  mutualLover: boolean;
  /** At least one cat is in love with a different cat (breeds less reliably). */
  lovesElsewhere: boolean;
}

export interface SuggestOptions {
  limit?: number;
  /** Drop pairs whose offspring birth-defect risk exceeds this %. Default 10. */
  maxRiskPercent?: number;
}

/** Index every cat by db_key so ancestry walks can resolve parents. */
export function catsByKey(cats: ParsedCat[]): Map<number, ParsedCat> {
  return new Map(cats.map((c) => [c.dbKey, c]));
}

/**
 * Rank candidate breeding pairs by projected 7-coverage at the given room
 * Stimulation. Only available (in-house), sex-compatible pairs whose offspring
 * birth-defect risk stays within `maxRiskPercent` are suggested. Each result
 * carries its offspring COI / risk% (computed from the full pedigree, so even
 * "Gone" ancestors count). Returns the strongest `limit` pairs.
 */
export function suggestFoundationPairs(
  cats: ParsedCat[],
  stimulation: number,
  opts: SuggestOptions = {},
): PairSuggestion[] {
  const { limit = 6, maxRiskPercent = 10 } = opts;
  const byKey = catsByKey(cats);
  const gen = buildGenerations(byKey);
  const kinship = makeKinship(byKey, gen);
  const pool = cats.filter(isAvailable);
  const out: PairSuggestion[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (!sexesCompatible(a.sex, b.sex)) continue;
      // Direct relations (parent/child, siblings) are excluded outright — this
      // catches them even when the shared parent isn't in the roster. Deeper
      // inbreeding is then gated by the COI-derived defect risk.
      if (isRelated(a, b)) continue;
      // Cats that hate each other won't reliably breed — drop them.
      if (hatesEachOther(a, b)) continue;
      const coi = kinship(a.dbKey, b.dbKey);
      const riskPercent = defectRiskPercent(coi);
      if (riskPercent > maxRiskPercent) continue;
      const coverage = pairCoverage(a.baseStats, b.baseStats, stimulation);
      const mutualLover = mutualLovers(a, b);
      const lovesElsewhere = lovesSomeoneElse(a, b) || lovesSomeoneElse(b, a);
      out.push({ a, b, coverage, missing: coverage.missing, related: false, coi, riskPercent, mutualLover, lovesElsewhere });
    }
  }

  // Best coverage first; then prefer pairs that will actually breed: mutual
  // lovers up, "loves someone else" down (game ±25% compatibility), then the
  // cleaner (lower-risk) pair. Coverage stays primary — genetics first.
  const loveRank = (s: PairSuggestion) => (s.mutualLover ? 1 : 0) - (s.lovesElsewhere ? 1 : 0);
  out.sort((x, y) =>
    y.coverage.coverage - x.coverage.coverage ||
    loveRank(y) - loveRank(x) ||
    x.riskPercent - y.riskPercent,
  );
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

/** Highest count of maxed (7) base stats across in-house cats (0 if none). */
export function bestSevens(cats: ParsedCat[]): number {
  const inHouse = cats.filter(isAvailable);
  return inHouse.reduce((m, c) => Math.max(m, sevensCount(c)), 0);
}

/**
 * Best-effort, data-driven progress: which Perfect-7 plan steps the save state
 * already satisfies, so the guide can auto-track the "next step" instead of
 * making the player tick boxes. These are heuristics over the loaded roster
 * (step ids match PERFECT7_STAGES in breeding.ts).
 */
export function deriveCompletedSteps(
  cats: ParsedCat[],
  suggestions: PairSuggestion[],
  hasViableRoom: boolean,
): Set<string> {
  const done = new Set<string>();
  const inHouse = cats.filter(isAvailable);
  const strong = (sex: Sex) => inHouse.filter((c) => c.sex === sex && sevensCount(c) >= 4);
  const elite = (sex: Sex) => inHouse.filter((c) => c.sex === sex && sevensCount(c) >= 6);
  const rooms = new Set(inHouse.map((c) => c.room).filter(Boolean));
  const best = suggestions[0];
  const max = bestSevens(cats);

  // Stage 1 — foundation pairs in a good room, keepers of each sex.
  if (suggestions.length > 0) done.add('s1-pairs');
  if (hasViableRoom) done.add('s1-room');
  if (strong('male').length >= 1 && strong('female').length >= 1) done.add('s1-keep');
  // Stage 2 — lines separated across rooms; a near-complete keeper pair.
  if (rooms.size >= 2) done.add('s2-rooms');
  if (best && best.missing.length <= 1) done.add('s2-keeper');
  // Stage 3 — strong enough to see gaps; a pair that already covers every 7.
  if (max >= 5) done.add('s3-detect');
  if (best && best.missing.length === 0) done.add('s3-outcross');
  // Stage 4 — finishing: a near-perfect cat, an opposite-sex backup, a perfect 7.
  if (max >= 6) done.add('s4-finish');
  if (elite('male').length >= 1 && elite('female').length >= 1 && rooms.size >= 2) done.add('s4-backup');
  if (max >= 7) done.add('s4-maintain');

  return done;
}
