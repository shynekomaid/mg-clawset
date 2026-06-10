import { describe, it, expect } from 'vitest';
import type { FurnitureItem, PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomConfig, isAtticCellValid, ATTIC_INDEX } from '../types/furniture';
import { statScore, autoPopulateRoom } from './autoPopulate';

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

  it('sums only the selected stats', () => {
    expect(statScore(item, ['comfort', 'stimulation'])).toBe(5);
    expect(statScore(item, ['appeal'])).toBe(1);
    expect(statScore(item, ['health', 'mutation'])).toBe(5);
  });

  it('empty selection scores zero', () => {
    expect(statScore(item, [])).toBe(0);
  });
});

function makeOpts(over: Partial<Parameters<typeof autoPopulateRoom>[0]>) {
  let n = 0;
  return {
    stats: ['comfort', 'stimulation'] as StatKey[],
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

  it('never places items with score <= 0 for the selected stats', () => {
    const junk = makeItem({ name: 'junk', appeal: 5, shape: [[2]] }); // appeal not selected
    const result = autoPopulateRoom(makeOpts({
      allFurniture: [junk],
      ownership: { junk: 10 },
    }));
    expect(result).toEqual([]);
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
      stats: ['comfort'] as StatKey[],
      allFurniture: [stimToy, bed],
      ownership: { toy: 5, bed: 1 },
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

    const score = (r: PlacedFurniture[]) => r.reduce((s, p) => s + statScore(p.item, ['comfort', 'stimulation']), 0);

    // never worse than greedy baseline
    expect(score(maxA)).toBeGreaterThanOrEqual(score(greedy));

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

  it('places anchored items only when anchor support exists', () => {
    // anchor (4) on top must sit on an anchor point (3); attic has no ceiling anchors
    const hanging = makeItem({ name: 'hanging', comfort: 10, shape: [[4], [2]] });
    const noSupport = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [hanging],
      ownership: { hanging: 1 },
    }));
    expect(noSupport).toEqual([]);

    // with an anchor-point provider placed first, the hanging item attaches
    const shelf = makeItem({ name: 'shelf', comfort: 1, shape: [[3]] });
    const withSupport = autoPopulateRoom(makeOpts({
      roomIndex: ATTIC_INDEX,
      allFurniture: [hanging, shelf],
      ownership: { hanging: 1, shelf: 1 },
    }));
    expect(withSupport.map(p => p.item.name).sort()).toEqual(['hanging', 'shelf']);
  });
});
