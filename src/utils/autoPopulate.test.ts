import { describe, it, expect } from 'vitest';
import type { FurnitureItem, PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomConfig, isAtticCellValid, ATTIC_INDEX } from '../types/furniture';
import { statScore, autoPopulateRoom, autoPopulateRoomAsync } from './autoPopulate';

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

  it('never places items with negative score for the selected stats', () => {
    const bad = makeItem({ name: 'bad', stimulation: 5, shape: [[2]] });
    const result = autoPopulateRoom(makeOpts({
      weights: { comfort: 1, stimulation: -1 } as Partial<Record<StatKey, number>>,
      allFurniture: [bad],
      ownership: { bad: 10 },
    }));
    expect(result).toEqual([]);
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

  it('mustInclude places every owned copy (food boxes)', () => {
    const foodbox = makeItem({ name: 'foodbox', shape: [[2, 2]] }); // zero stats
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
});
