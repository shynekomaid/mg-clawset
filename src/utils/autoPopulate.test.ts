import { describe, it, expect } from 'vitest';
import type { FurnitureItem, PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomConfig, isAtticCellValid, ATTIC_INDEX } from '../types/furniture';
import { statScore, autoPopulateRoom, autoPopulateRoomAsync, pushScore, isConverged, preAllocateItems } from './autoPopulate';

function makeItem(over: Partial<FurnitureItem> & { name: string }): FurnitureItem {
  const shape = over.shape ?? [[2]];
  let spaces = 0;
  for (const row of shape) for (const cell of row) if (cell === 2 || cell === 3) spaces++;
  spaces = Math.max(spaces, 1);
  const base = {
    image_url: '',
    appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0,
    ...over,
    shape,
  };
  return {
    ...base,
    id: over.id ?? over.name,
    spacesOccupied: spaces,
    appealPerSpace: base.appeal / spaces,
    comfortPerSpace: base.comfort / spaces,
    stimulationPerSpace: base.stimulation / spaces,
    healthPerSpace: base.health / spaces,
    mutationPerSpace: base.mutation / spaces,
  };
}

describe('statScore', () => {
  const item = makeItem({ name: 'x', appeal: 1, comfort: 2, stimulation: 3, health: 1, mutation: 4 });

  it('sums weighted stats', () => {
    expect(statScore(item, { comfort: 1, stimulation: 1 })).toBe(5);
    expect(statScore(item, { appeal: 1 })).toBe(1);
    expect(statScore(item, { health: 1, mutation: 1 })).toBe(5);
  });

  it('negative weights penalize', () => {
    expect(statScore(item, { mutation: 1, comfort: 1, stimulation: -1 })).toBe(3);
  });

  it('empty selection scores zero', () => {
    expect(statScore(item, {})).toBe(0);
  });
});

function makeOpts(over: Partial<Parameters<typeof autoPopulateRoom>[0]>) {
  let n = 0;
  return {
    weights: { comfort: 1, stimulation: 1 } as Partial<Record<StatKey, number>>,
    roomIndex: 0,
    allFurniture: [],
    ownership: {},
    usedInOtherRooms: {},
    makeInstanceId: () => `t-${n++}`,
    ...over,
  };
}

function solidCells(p: PlacedFurniture): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < p.item.shape.length; r++) {
    for (let c = 0; c < p.item.shape[r].length; c++) {
      if (p.item.shape[r][c] === 2 || p.item.shape[r][c] === 3) {
        out.push([p.row + r, p.col + c]);
      }
    }
  }
  return out;
}

describe('autoPopulateRoom', () => {
  it('returns empty for empty pool', () => {
    expect(autoPopulateRoom(makeOpts({}))).toEqual([]);
  });

  it('never exceeds remaining counts (ownership minus other rooms)', () => {
    const item = makeItem({ name: 'sofa', comfort: 5, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [item],
      ownership: { sofa: 5 },
      usedInOtherRooms: { sofa: 2 },
    }));
    expect(result).toHaveLength(3);
  });

  it('places negative-score items as last-resort fillers (Phase 6)', () => {
    const bad = makeItem({ name: 'bad', stimulation: 5, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { comfort: 1, stimulation: -1 } as Partial<Record<StatKey, number>>,
      allFurniture: [bad],
      ownership: { bad: 10 },
    }));
    // Phase 6 places negative-score items that still fit; previously filtered out.
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(p => p.item.name === 'bad')).toBe(true);
  });

  it('uses neutral items as space fillers unless noFillers is set', () => {
    const junk = makeItem({ name: 'junk', appeal: 5, shape: [[2]] }); // appeal not selected
    const base = { allFurniture: [junk], ownership: { junk: 10 } };
    expect(autoPopulateRoom(makeOpts(base))).toHaveLength(10);
    expect(autoPopulateRoom(makeOpts({ ...base, noFillers: true }))).toEqual([]);
  });

  it('produces no overlaps and stays in bounds', () => {
    const big = makeItem({ name: 'big', comfort: 4, shape: [[2, 2], [2, 2]] });
    const small = makeItem({ name: 'small', comfort: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [big, small],
      ownership: { big: 100, small: 200 },
    }));
    const cfg = getRoomConfig(0);
    const seen = new Set<string>();
    for (const p of result) {
      for (const [r, c] of solidCells(p)) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(cfg.rows);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(cfg.cols);
        expect(seen.has(`${r},${c}`)).toBe(false);
        seen.add(`${r},${c}`);
      }
    }
    // 16x7 room, plenty of 1x1s owned: room should be completely full
    expect(seen.size).toBe(cfg.rows * cfg.cols);
  });

  it('prefers higher score-per-space items', () => {
    const good = makeItem({ name: 'good', comfort: 9, shape: [[2]] });
    const bad = makeItem({ name: 'bad', comfort: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [bad, good],
      ownership: { good: 1, bad: 1 },
    }));
    expect(result[0].item.name).toBe('good');
  });

  it('unselected stats do not contribute to placement', () => {
    const stimToy = makeItem({ name: 'toy', stimulation: 3, shape: [[2]] });
    const bed = makeItem({ name: 'bed', comfort: 2, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { comfort: 1 } as Partial<Record<StatKey, number>>,
      allFurniture: [stimToy, bed],
      ownership: { toy: 5, bed: 1 },
      noFillers: true,
    }));
    expect(result).toHaveLength(1);
    expect(result[0].item.name).toBe('bed');
  });

  it('respects attic cell validity', () => {
    const item = makeItem({ name: 'cube', comfort: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [item],
      ownership: { cube: 500 },
    }));
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      for (const [r, c] of solidCells(p)) {
        expect(isAtticCellValid(r, c)).toBe(true);
      }
    }
  });

  it('maximize: valid, deterministic per seed, and never worse than greedy', () => {
    // mix of awkward shapes so first-fit leaves holes
    const square = makeItem({ name: 'square', comfort: 8, shape: [[2, 2], [2, 2]] });
    const lpiece = makeItem({ name: 'lpiece', comfort: 7, shape: [[2, 1], [2, 1], [2, 2]] });
    const bar = makeItem({ name: 'bar', comfort: 5, shape: [[2, 2, 2]] });
    const dot = makeItem({ name: 'dot', comfort: 1, shape: [[2]] });
    const pool = {
      allFurniture: [square, lpiece, bar, dot],
      ownership: { square: 10, lpiece: 10, bar: 10, dot: 30 },
    };

    const greedy = autoPopulateRoom(makeOpts({ ...pool }));
    const maxA = autoPopulateRoom(makeOpts({ ...pool, algorithm: 'maximize', seed: 42, iterations: 30 }));
    const maxB = autoPopulateRoom(makeOpts({ ...pool, algorithm: 'maximize', seed: 42, iterations: 30 }));

    const score = (r: PlacedFurniture[]) => r.reduce((s, p) => s + statScore(p.item, { comfort: 1, stimulation: 1 }), 0);

    // never worse than greedy baseline (within coverage epsilon — may trade ≤5 score for more cells filled)
    expect(score(maxA)).toBeGreaterThanOrEqual(score(greedy) - 5);

    // deterministic for fixed seed
    expect(maxB.map(p => `${p.item.id}@${p.row},${p.col}`).sort())
      .toEqual(maxA.map(p => `${p.item.id}@${p.row},${p.col}`).sort());

    // all placements valid: in bounds, no overlap, counts respected
    const cfg = getRoomConfig(0);
    const seen = new Set<string>();
    const used: Record<string, number> = {};
    for (const p of maxA) {
      used[p.item.id] = (used[p.item.id] || 0) + 1;
      for (const [r, c] of solidCells(p)) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(cfg.rows);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(cfg.cols);
        expect(seen.has(`${r},${c}`)).toBe(false);
        seen.add(`${r},${c}`);
      }
    }
    for (const [id, n] of Object.entries(used)) {
      expect(n).toBeLessThanOrEqual(pool.ownership[id as keyof typeof pool.ownership]);
    }
  });

  it('keep-search premise: varying seeds explore layouts; best across seeds >= greedy', () => {
    // The App "Keep searching" loop runs one fixed-iteration pass per seed and
    // keeps the highest-scoring result. This verifies the two properties that
    // loop relies on: different seeds can yield different layouts (so passes
    // actually explore), and the best of many seeds never beats-down greedy.
    const square = makeItem({ name: 'square', comfort: 8, shape: [[2, 2], [2, 2]] });
    const lpiece = makeItem({ name: 'lpiece', comfort: 7, shape: [[2, 1], [2, 1], [2, 2]] });
    const bar = makeItem({ name: 'bar', comfort: 5, shape: [[2, 2, 2]] });
    const dot = makeItem({ name: 'dot', comfort: 1, shape: [[2]] });
    const pool = {
      allFurniture: [square, lpiece, bar, dot],
      ownership: { square: 10, lpiece: 10, bar: 10, dot: 30 },
    };
    const score = (r: PlacedFurniture[]) => r.reduce((s, p) => s + statScore(p.item, { comfort: 1, stimulation: 1 }), 0);

    const greedyScore = score(autoPopulateRoom(makeOpts({ ...pool })));
    const layouts: string[] = [];
    let best = -Infinity;
    for (let seed = 1; seed <= 8; seed++) {
      const r = autoPopulateRoom(makeOpts({ ...pool, algorithm: 'maximize', seed, iterations: 25 }));
      layouts.push(r.map((p) => `${p.item.id}@${p.row},${p.col}`).sort().join('|'));
      best = Math.max(best, score(r));
    }
    // exploration: not every seed collapses to the identical placement
    expect(new Set(layouts).size).toBeGreaterThan(1);
    // keeping the best is at least as good as the greedy baseline (within coverage epsilon)
    expect(best).toBeGreaterThanOrEqual(greedyScore - 5);
  });

  it('maximize: anchored pieces remain supported after ruin-and-recreate', () => {
    const shelf = makeItem({ name: 'shelf', comfort: 2, shape: [[3]] });
    const hanging = makeItem({ name: 'hanging', comfort: 6, shape: [[4], [2]] });
    const result = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX, // no ceiling anchors: hangers need placed shelves
      allFurniture: [shelf, hanging],
      ownership: { shelf: 6, hanging: 6 },
      algorithm: 'maximize',
      seed: 7,
      iterations: 20,
    }));
    // every hanging anchor cell must coincide with a shelf anchor-point cell
    const anchorPointCells = new Set<string>();
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 3) anchorPointCells.add(`${p.row + r},${p.col + c}`);
        }
      }
    }
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 4) {
            expect(anchorPointCells.has(`${p.row + r},${p.col + c}`)).toBe(true);
          }
        }
      }
    }
  });

  it('minStats places floor-satisfying items before maximizing', () => {
    const toy = makeItem({ name: 'toy', stimulation: 3, shape: [[2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { stimulation: 1 } as Partial<Record<StatKey, number>>,
      minStats: { comfort: 4 },
      allFurniture: [toy, sofa],
      ownership: { toy: 200, sofa: 5 },
    }));
    const comfort = result.reduce((s, p) => s + p.item.comfort, 0);
    expect(comfort).toBeGreaterThanOrEqual(4);
    // floor met with minimal comfort items, rest is stimulation
    expect(result.filter(p => p.item.name === 'sofa')).toHaveLength(2);
    expect(result.filter(p => p.item.name === 'toy').length).toBeGreaterThan(50);
  });

  it('minStats survives negative-comfort filler items', () => {
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    const edgyToy = makeItem({ name: 'edgy', stimulation: 3, comfort: -1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { stimulation: 1 } as Partial<Record<StatKey, number>>,
      minStats: { comfort: 4 },
      allFurniture: [sofa, edgyToy],
      ownership: { sofa: 10, edgy: 200 },
    }));
    const comfort = result.reduce((s, p) => s + p.item.comfort, 0);
    expect(comfort).toBeGreaterThanOrEqual(4);
    expect(result.some(p => p.item.name === 'edgy')).toBe(true); // still fills with stim items
  });

  it('minStats also holds for maximize algorithm', () => {
    const toy = makeItem({ name: 'toy', stimulation: 3, shape: [[2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { stimulation: 1 } as Partial<Record<StatKey, number>>,
      minStats: { comfort: 4 },
      allFurniture: [toy, sofa],
      ownership: { toy: 200, sofa: 5 },
      algorithm: 'maximize',
      seed: 11,
      iterations: 10,
    }));
    const comfort = result.reduce((s, p) => s + p.item.comfort, 0);
    expect(comfort).toBeGreaterThanOrEqual(4);
  });

  it('mustInclude places every owned copy when no cross-room cap applies', () => {
    // Direct call to autoPopulateRoom: no globalReserved, no cross-room
    // reservation — all owned copies of a mandatory item are fair game.
    const foodbox = makeItem({ name: 'foodbox', shape: [[2, 2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [foodbox, sofa],
      ownership: { foodbox: 3, sofa: 2 },
      mustInclude: ['foodbox'],
    }));
    expect(result.filter(p => p.item.name === 'foodbox')).toHaveLength(3);
  });

  it('mustInclude forces items in even with non-positive score', () => {
    const chaosIdol = makeItem({ name: 'Idol of Chaos', comfort: -5, shape: [[2], [2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 3, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [chaosIdol, sofa],
      ownership: { 'Idol of Chaos': 1, sofa: 5 },
      mustInclude: ['Idol of Chaos'],
    }));
    expect(result.filter(p => p.item.name === 'Idol of Chaos')).toHaveLength(1);
    expect(result.filter(p => p.item.name === 'sofa')).toHaveLength(5);
  });

  it('mustInclude survives maximize ruin-and-recreate', () => {
    const idol = makeItem({ name: 'idol', comfort: -5, shape: [[2]] });
    const block = makeItem({ name: 'block', comfort: 2, shape: [[2, 2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [idol, block],
      ownership: { idol: 1, block: 100 },
      mustInclude: ['idol'],
      algorithm: 'maximize',
      seed: 5,
      iterations: 15,
    }));
    expect(result.filter(p => p.item.name === 'idol')).toHaveLength(1);
  });

  it('places anchored items only when anchor support exists', () => {
    // anchor (4) on top must sit on an anchor point (3); attic has no ceiling anchors
    const hanging = makeItem({ name: 'hanging', comfort: 10, shape: [[4], [2]] });
    const noSupport = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [hanging],
      ownership: { hanging: 1 },
    }));
    expect(noSupport).toEqual([]);

    // with a floor-standing anchor-point provider, the hanging item attaches
    // (AP sits atop the stand with a free cell beneath it for the hanger)
    const shelf = makeItem({ name: 'shelf', comfort: 1, shape: [[3, 1], [1, 2], [1, 2]] });
    const withSupport = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [hanging, shelf],
      ownership: { hanging: 1, shelf: 1 },
    }));
    expect(withSupport.map(p => p.item.name).sort()).toEqual(['hanging', 'shelf']);
  });

  it('anchorless items cannot float in the attic but may rest on the floor', () => {
    const picture = makeItem({ name: 'picture', comfort: 5, shape: [[2]] });
    const inAttic = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [picture],
      ownership: { picture: 60 },
    }));
    // attic floor row holds 31 cells; without wall support nothing stacks higher
    expect(inAttic.length).toBeGreaterThan(0);
    for (const p of inAttic) expect(p.row).toBe(7);
    // regular rooms have a back wall: free placement everywhere
    const inRoom = autoPopulateRoom(makeOpts({
      allFurniture: [picture],
      ownership: { picture: 200 },
    }));
    expect(inRoom.length).toBe(16 * 7);
  });

  it('fillers never displace scoring items', () => {
    // junk scores 0; sofa scores. Room must hold all sofas plus junk in gaps.
    const sofa = makeItem({ name: 'sofa', comfort: 3, shape: [[2, 2]] });
    const junk = makeItem({ name: 'junk', appeal: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { comfort: 1 } as Partial<Record<StatKey, number>>,
      allFurniture: [junk, sofa],
      ownership: { junk: 500, sofa: 4 },
    }));
    expect(result.filter(p => p.item.name === 'sofa')).toHaveLength(4);
    // gaps fully packed with junk: 16x7 room
    const cells = result.reduce((s, p) => s + p.item.spacesOccupied, 0);
    expect(cells).toBe(16 * 7);
  });

  it('maximize packs large scoring items alongside small ones', () => {
    // 12 cells of 2x3 bookcases + small toys; bookcases beat toys per cell,
    // so the best layout keeps both bookcases and packs toys in the gaps.
    const bookcase = makeItem({ name: 'bookcase', comfort: 9, shape: [[2, 2], [2, 2], [2, 2]] });
    const toy = makeItem({ name: 'toy', comfort: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { comfort: 1 } as Partial<Record<StatKey, number>>,
      allFurniture: [bookcase, toy],
      ownership: { bookcase: 2, toy: 200 },
      algorithm: 'maximize',
      seed: 7,
      iterations: 30,
    }));
    expect(result.filter(p => p.item.name === 'bookcase')).toHaveLength(2);
    const cells = result.reduce((s, p) => s + p.item.spacesOccupied, 0);
    expect(cells).toBe(16 * 7);
  });

  it('async variant reports progress and matches the sync contract', async () => {
    const item = makeItem({ name: 'sofa', comfort: 5, shape: [[2]] });
    const fractions: number[] = [];
    const result = await autoPopulateRoomAsync(makeOpts({
      allFurniture: [item],
      ownership: { sofa: 3 },
      algorithm: 'maximize',
      seed: 1,
      iterations: 5,
    }), (p) => fractions.push(p.fraction));
    expect(result).toHaveLength(3);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1])).toBe(true);
  });

  it('excludeItemIds prevents owned items from being placed', () => {
    const idol = makeItem({ name: 'Idol of Chastity', comfort: 5, shape: [[2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    // Room needs comfort floor of 4; idol has high comfort:5 but is excluded.
    const result = autoPopulateRoom(makeOpts({
      weights: { stimulation: 1 } as Partial<Record<StatKey, number>>,
      minStats: { comfort: 4 },
      allFurniture: [idol, sofa],
      ownership: { 'Idol of Chastity': 5, sofa: 10 },
      excludeItemIds: ['Idol of Chastity'],
    }));
    // Idol should not appear (excluded), comfort floor should still be met via sofas.
    expect(result.filter(p => p.item.name === 'Idol of Chastity')).toHaveLength(0);
    const comfort = result.reduce((s, p) => s + p.item.comfort, 0);
    expect(comfort).toBeGreaterThanOrEqual(4);
  });

  it('excludeItemIds does not block mustInclude items', () => {
    const idol = makeItem({ name: 'Idol of Chastity', comfort: 5, shape: [[2]] });
    const sofa = makeItem({ name: 'sofa', comfort: 2, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [idol, sofa],
      ownership: { 'Idol of Chastity': 1, sofa: 10 },
      mustInclude: ['Idol of Chastity'],
      excludeItemIds: ['Idol of Chastity'], // excluded but also forced → must win
    }));
    expect(result.filter(p => p.item.name === 'Idol of Chastity')).toHaveLength(1);
  });

  // --- T10: Anchor-aware ruin-and-recreate ---

  it('anchor-aware: maximize with anchor bias in attic produces valid layout', () => {
    const shelf = makeItem({ name: 'shelf', comfort: 2, shape: [[3]] });
    const hanging = makeItem({ name: 'hanging', comfort: 6, shape: [[4], [2]] });
    const dot = makeItem({ name: 'dot', comfort: 1, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [shelf, hanging, dot],
      ownership: { shelf: 8, hanging: 8, dot: 30 },
      algorithm: 'maximize',
      seed: 13,
      iterations: 20,
    }));
    // every hanging anchor cell must coincide with a shelf anchor-point cell
    const anchorPointCells = new Set<string>();
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 3) anchorPointCells.add(`${p.row + r},${p.col + c}`);
        }
      }
    }
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 4) {
            expect(anchorPointCells.has(`${p.row + r},${p.col + c}`)).toBe(true);
          }
        }
      }
    }
  });

  it('anchor-aware: maximize in room with no anchor pieces still works', () => {
    const dot = makeItem({ name: 'dot', comfort: 1, shape: [[2]] });
    const block = makeItem({ name: 'block', comfort: 3, shape: [[2, 2]] });
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [dot, block],
      ownership: { dot: 50, block: 10 },
      algorithm: 'maximize',
      seed: 7,
      iterations: 15,
    }));
    // Room should fill with no crashes (all type-2 cells, no anchors at all)
    expect(result.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const p of result) {
      for (const [r, c] of solidCells(p)) {
        expect(seen.has(`${r},${c}`)).toBe(false);
        seen.add(`${r},${c}`);
      }
    }
  });

  it('anchor-aware: maximize with anchor-heavy setup finds good layout', () => {
    const shelf = makeItem({ name: 'shelf', comfort: 2, shape: [[3]] });
    const hanging = makeItem({ name: 'hanging', comfort: 6, shape: [[4], [2]] });
    const bookcase = makeItem({ name: 'bookcase', comfort: 9, shape: [[2, 2], [2, 2], [2, 2]] });
    const result = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [shelf, hanging, bookcase],
      ownership: { shelf: 10, hanging: 10, bookcase: 3 },
      algorithm: 'maximize',
      seed: 17,
      iterations: 20,
    }));
    // bookcases should place (they're high-scoring)
    expect(result.filter(p => p.item.name === 'bookcase').length).toBeGreaterThan(0);
    // all anchor invariants hold
    const anchorPointCells = new Set<string>();
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 3) anchorPointCells.add(`${p.row + r},${p.col + c}`);
        }
      }
    }
    for (const p of result) {
      for (let r = 0; r < p.item.shape.length; r++) {
        for (let c = 0; c < p.item.shape[r].length; c++) {
          if (p.item.shape[r][c] === 4) {
            expect(anchorPointCells.has(`${p.row + r},${p.col + c}`)).toBe(true);
          }
        }
      }
    }
  });

  // --- T12: Temperature convergence helpers ---

  describe('pushScore', () => {
    it('appends to empty window', () => {
      expect(pushScore([], 100, 10)).toEqual([100]);
    });

    it('truncates to maxLen', () => {
      expect(pushScore([1, 2, 3], 4, 3)).toEqual([2, 3, 4]);
    });

    it('keeps within limit', () => {
      const w = pushScore([1, 2, 3, 4, 5], 6, 5);
      expect(w).toHaveLength(5);
      expect(w).toEqual([2, 3, 4, 5, 6]);
    });
  });

  describe('isConverged', () => {
    it('false when improvement exceeds threshold', () => {
      expect(isConverged([100, 101], 0.005)).toBe(false);
    });

    it('true when all scores are identical', () => {
      expect(isConverged([100, 100, 100], 0.01)).toBe(true);
    });

    it('false when too few entries', () => {
      expect(isConverged([100], 0.01)).toBe(false);
    });

    it('false when improvement exceeds threshold (smaller spread)', () => {
      expect(isConverged([100, 100, 101], 0.005)).toBe(false);
    });

    it('true when all scores are zero', () => {
      expect(isConverged([0, 0, 0], 0.01)).toBe(true);
    });

    it('true when spread is below threshold', () => {
      expect(isConverged([100, 100, 100.5], 0.01)).toBe(true);
    });

    it('false when too few entries (need at least 2)', () => {
      expect(isConverged([0], 0.01)).toBe(false);
    });
  });

  // --- T11: Cross-room preAllocateItems ---

  describe('preAllocateItems', () => {
    it('item with clear winner room gets allocated there', () => {
      const comfortItem = makeItem({ name: 'sofa', comfort: 5, stimulation: 0 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [comfortItem], { sofa: 3 });
      expect(alloc[0].sofa).toBe(3);
      expect(alloc[1].sofa).toBeUndefined();
    });

    it('item with equal scores in all rooms stays shared', () => {
      const neutral = makeItem({ name: 'pot', comfort: 3, stimulation: 3 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1, stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { comfort: 1, stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [neutral], { pot: 5 });
      expect(alloc[0].pot).toBeUndefined();
      expect(alloc[1].pot).toBeUndefined();
    });

    it('mustInclude items are skipped (not double-allocated)', () => {
      const idol = makeItem({ name: 'idol', comfort: 5 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: ['idol'], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [idol], { idol: 1 });
      // mustInclude items are handled by existing reservation — preAllocate skips them
      expect(alloc[0].idol).toBeUndefined();
      expect(alloc[1].idol).toBeUndefined();
    });

    it('items with zero score everywhere are not allocated', () => {
      const junk = makeItem({ name: 'junk', appeal: 5 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [junk], { junk: 10 });
      expect(alloc[0].junk).toBeUndefined();
      expect(alloc[1].junk).toBeUndefined();
    });

    it('items where only one room scores positive go there', () => {
      const stimToy = makeItem({ name: 'toy', stimulation: 5 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [stimToy], { toy: 2 });
      expect(alloc[0].toy).toBeUndefined();
      expect(alloc[1].toy).toBe(2);
    });

    it('multiple items each get correct allocation', () => {
      const sofa = makeItem({ name: 'sofa', comfort: 5 });
      const toy = makeItem({ name: 'toy', stimulation: 4 });
      const neutral = makeItem({ name: 'pot', comfort: 2, stimulation: 2 });
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
        { roomIndex: 1, weights: { stimulation: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [sofa, toy, neutral], { sofa: 3, toy: 4, pot: 2 });
      expect(alloc[0].sofa).toBe(3);
      expect(alloc[0].toy).toBeUndefined();
      expect(alloc[0].pot).toBeUndefined();
      expect(alloc[1].sofa).toBeUndefined();
      expect(alloc[1].toy).toBe(4);
      expect(alloc[1].pot).toBeUndefined();
    });

    it('empty ownership returns empty allocations', () => {
      const plans = [
        { roomIndex: 0, weights: { comfort: 1 } as Partial<Record<StatKey, number>>, mustInclude: [], minStats: {}, excludeItemIds: [] },
      ];
      const alloc = preAllocateItems(plans, [], {});
      expect(alloc[0]).toEqual({});
    });
  });
}); // end describe('autoPopulateRoom')
