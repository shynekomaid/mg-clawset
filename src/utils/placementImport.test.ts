import { describe, it, expect } from 'vitest';
import { applyRoomPlacements } from './placementImport';
import type { FurnitureItem } from '../types/furniture';
import type { SavedPlacement } from './savegame';

const mkItem = (id: string, shape: number[][]): FurnitureItem => ({
  id,
  name: id,
  image_url: `graphics/FURNITURE_${id}.svg`,
  shape,
  appeal: 0,
  comfort: 0,
  stimulation: 0,
  health: 0,
  mutation: 0,
} as FurnitureItem);

// shapes mirroring real data
const box = mkItem('box', [[3, 3], [4, 4]]);          // 2-wide platform (Food Box)
const trinket = mkItem('trinket', [[2], [4]]);        // 1x1 standing item
const tallLamp = mkItem('lamp', [[2], [2], [2], [4]]); // 3-high floor item
const wallPlate = mkItem('plate', [[2, 2], [2, 2]]);  // wallmounted, no anchors

const byId = new Map([box, trinket, tallLamp, wallPlate].map((i) => [i.id, i]));

const pl = (itemId: string, col: number, row: number, order: number): SavedPlacement =>
  ({ itemId, roomIndex: 0, col, row, order });

// regular room: 7 rows (0-6), floor anchors land on row 7
describe('applyRoomPlacements', () => {
  it('keeps floor items at their saved position', () => {
    const out = applyRoomPlacements(0, [pl('trinket', 4, 6, 1)], byId);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ row: 6, col: 4 });
  });

  it('keeps a stack standing on a supporter intact', () => {
    const out = applyRoomPlacements(0, [
      pl('box', 4, 6, 1),      // platform on the floor
      pl('trinket', 4, 5, 2),  // standing on the platform
    ], byId);
    expect(out[1]).toMatchObject({ row: 5, col: 4 });
  });

  it('settles an unsupported standing item down to the floor', () => {
    // saved two rows above the floor with nothing beneath
    const out = applyRoomPlacements(0, [pl('lamp', 8, 4, 1)], byId);
    // bottom solid row must be the floor row (6); shape solids span rows 0-2
    expect(out[0].row).toBe(4);
  });

  it('settles a floater onto furniture below it', () => {
    const out = applyRoomPlacements(0, [
      pl('box', 8, 6, 1),       // on the floor
      pl('trinket', 8, 3, 2),   // floating two rows above the box
    ], byId);
    expect(out[1]).toMatchObject({ row: 5, col: 8 });
  });

  it('drops an item that only has a taller neighbour beside it', () => {
    // nothing directly under the trinket's column: standing beside a
    // platform is not support - it must fall to the floor
    const out = applyRoomPlacements(0, [
      pl('box', 9, 6, 1),       // floor platform at cols 9-10
      pl('trinket', 8, 5, 2),   // diagonally above its left edge
    ], byId);
    expect(out[1]).toMatchObject({ row: 6, col: 8 });
  });

  it('leaves wallmounted items where the save puts them', () => {
    const out = applyRoomPlacements(0, [pl('plate', 5, 1, 1)], byId);
    expect(out[0]).toMatchObject({ row: 1, col: 5 });
  });

  it('clamps stacked items that would start above the room', () => {
    const out = applyRoomPlacements(0, [
      pl('box', 4, 1, 1),       // platform high up (on some unsaved support)
      pl('lamp', 4, 0, 2),      // bottom solid at row 0 -> top would be row -2
    ], byId);
    expect(out[1].row).toBeGreaterThanOrEqual(0);
  });

  it('sinks a self-supporting mid-air cluster to the floor as one stack', () => {
    // box at row 2 with a trinket on it at row 1: each "supports" the other's
    // record but the chain never touches the floor — both must sink 4 rows
    const out = applyRoomPlacements(0, [
      pl('box', 4, 2, 1),
      pl('trinket', 4, 1, 2),
    ], byId);
    expect(out[0]).toMatchObject({ row: 6, col: 4 });   // box on the floor
    expect(out[1]).toMatchObject({ row: 5, col: 4 });   // trinket still on the box
  });

  it('snaps a trinket carrying its supporter cell coordinates on top', () => {
    const out = applyRoomPlacements(0, [
      pl('box', 4, 6, 1),
      pl('trinket', 4, 6, 2),   // same cell as the box -> sits on top
    ], byId);
    expect(out[1]).toMatchObject({ row: 5, col: 4 });
  });
});
