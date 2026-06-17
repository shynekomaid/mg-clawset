import { describe, it, expect } from 'vitest';
import { isRelated, suggestFoundationPairs, summarizeRoster, sevensCount } from './breedingRoster';
import { CAT_STATS } from './breeding';
import type { ParsedCat, Sex } from './catParser';
import type { CatStat } from './breeding';

let nextKey = 1;
function cat(opts: { sex: Sex; stats: Partial<Record<CatStat, number>>; parents?: number[]; status?: ParsedCat['status']; name?: string }): ParsedCat {
  const dbKey = nextKey++;
  const baseStats = {} as Record<CatStat, number>;
  for (const s of CAT_STATS) baseStats[s] = opts.stats[s] ?? 4;
  return {
    dbKey,
    uid: '0x0',
    uidInt: 0,
    name: opts.name ?? `Cat${dbKey}`,
    sex: opts.sex,
    baseStats,
    baseSum: (Object.values(baseStats) as number[]).reduce((a, b) => a + b, 0),
    aggression: 0.2,
    libido: 0.5,
    status: opts.status ?? 'In House',
    room: 'Floor1_Large',
    parents: opts.parents ?? [],
    loverKeys: [],
  };
}

describe('isRelated', () => {
  it('flags parent/child', () => {
    const parent = cat({ sex: 'female', stats: {} });
    const child = cat({ sex: 'male', stats: {}, parents: [parent.dbKey] });
    expect(isRelated(parent, child)).toBe(true);
  });
  it('flags siblings (shared parent)', () => {
    const a = cat({ sex: 'male', stats: {}, parents: [100, 101] });
    const b = cat({ sex: 'female', stats: {}, parents: [101, 102] });
    expect(isRelated(a, b)).toBe(true);
  });
  it('treats unrelated cats as unrelated', () => {
    const a = cat({ sex: 'male', stats: {}, parents: [1, 2] });
    const b = cat({ sex: 'female', stats: {}, parents: [3, 4] });
    expect(isRelated(a, b)).toBe(false);
  });
});

describe('suggestFoundationPairs', () => {
  it('ranks unrelated opposite-sex pairs by coverage and excludes relatives', () => {
    // perfect-complement pair: between them every stat is 7
    const m = cat({ sex: 'male', stats: { STR: 7, DEX: 7, CON: 7, INT: 7 }, parents: [10, 11], name: 'Dad' });
    const f = cat({ sex: 'female', stats: { SPD: 7, CHA: 7, LCK: 7, CON: 7 }, parents: [12, 13], name: 'Mom' });
    // weaker pair
    const f2 = cat({ sex: 'female', stats: { STR: 5 }, parents: [14, 15], name: 'Mid' });
    // related to m (shares parent 10) — must be excluded
    const fRel = cat({ sex: 'female', stats: { SPD: 7, CHA: 7, LCK: 7, CON: 7 }, parents: [10, 99], name: 'Sis' });

    const pairs = suggestFoundationPairs([m, f, f2, fRel], 100, 5);
    expect(pairs.length).toBeGreaterThan(0);
    // best pair is Dad×Mom (full coverage)
    expect(new Set([pairs[0].a.name, pairs[0].b.name])).toEqual(new Set(['Dad', 'Mom']));
    // no suggested pair includes the related female with Dad
    const hasRelated = pairs.some((p) => (p.a.name === 'Sis' && p.b.name === 'Dad') || (p.a.name === 'Dad' && p.b.name === 'Sis'));
    expect(hasRelated).toBe(false);
  });

  it('skips cats that are not in the house', () => {
    const m = cat({ sex: 'male', stats: {}, status: 'Gone' });
    const f = cat({ sex: 'female', stats: {} });
    expect(suggestFoundationPairs([m, f], 50)).toHaveLength(0);
  });
});

describe('summarizeRoster', () => {
  it('counts presence and sexes', () => {
    const r = summarizeRoster([
      cat({ sex: 'male', stats: { STR: 7, DEX: 7 } }),
      cat({ sex: 'female', stats: {} }),
      cat({ sex: 'male', stats: {}, status: 'Gone' }),
    ]);
    expect(r.total).toBe(3);
    expect(r.inHouse).toBe(2);
    expect(r.males).toBe(2);
    expect(r.females).toBe(1);
  });
});

describe('sevensCount', () => {
  it('counts stats already at 7', () => {
    expect(sevensCount(cat({ sex: 'male', stats: { STR: 7, CHA: 7, LCK: 7 } }))).toBe(3);
  });
});
