import { describe, it, expect } from 'vitest';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import { getRoomConfig, isAtticCellValid, ATTIC_INDEX } from '../types/furniture';
import { presetScore, autoPopulateRoom } from './autoPopulate';

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

describe('presetScore', () => {
  const item = makeItem({ name: 'x', comfort: 2, stimulation: 3, health: 1, mutation: 4 });

  it('breeding = comfort + stimulation', () => {
    expect(presetScore(item, 'breeding')).toBe(5);
  });

  it('storage = 0.5*comfort + health - stimulation', () => {
    expect(presetScore(item, 'storage')).toBe(2 * 0.5 + 1 - 3); // -1
  });

  it('mutation = 0.5*comfort + mutation', () => {
    expect(presetScore(item, 'mutation')).toBe(5);
  });
});

function makeOpts(over: Partial<Parameters<typeof autoPopulateRoom>[0]>) {
  let n = 0;
  return {
    preset: 'breeding' as const,
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

  it('never places items with score <= 0', () => {
    const junk = makeItem({ name: 'junk', appeal: 5, shape: [[2]] }); // breeding score 0
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

  it('storage preset rejects net-negative stimulation items', () => {
    const stimToy = makeItem({ name: 'toy', comfort: 2, stimulation: 3, shape: [[2]] }); // storage: 1 - 3 < 0
    const bed = makeItem({ name: 'bed', comfort: 2, health: 1, shape: [[2]] }); // storage: 2
    const result = autoPopulateRoom(makeOpts({
      preset: 'storage',
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
