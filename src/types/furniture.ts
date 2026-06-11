export interface RawFurnitureItem {
  name: string;
  image_url: string;
  shape: number[][];
  appeal: number;
  comfort: number;
  stimulation: number;
  health: number;
  mutation: number;
}

export interface FurnitureItem extends RawFurnitureItem {
  id: string;
  spacesOccupied: number;
  appealPerSpace: number;
  comfortPerSpace: number;
  stimulationPerSpace: number;
  healthPerSpace: number;
  mutationPerSpace: number;
}

export type StatKey = 'appeal' | 'comfort' | 'stimulation' | 'health' | 'mutation';

export type SortField = 'name' | StatKey | 'owned' | 'remaining';
export type SortDirection = 'asc' | 'desc';

export interface Filters {
  name: string;
  minAppeal: number;
  minComfort: number;
  minStimulation: number;
  minHealth: number;
  minMutation: number;
  onlyOwned: boolean;
  shapeWidth: number | null;
  shapeHeight: number | null;
  exactShape: (number | null)[][] | null;
  anchorFilter: 'any' | 'anchored' | 'not-anchored';
  onlyRemaining: boolean;
}

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export interface PlacedFurniture {
  instanceId: string;
  item: FurnitureItem;
  row: number;
  col: number;
}

export const ROOM_COLS = 16;
export const ROOM_ROWS = 7;

export const ATTIC_COLS = 31;
export const ATTIC_ROWS = 8;
export const ATTIC_INDEX = 4;

export function isAtticCellValid(row: number, col: number): boolean {
  if (row < 0 || row >= ATTIC_ROWS || col < 0 || col >= ATTIC_COLS) return false;
  const width = 3 + row * 4;
  const startCol = 14 - row * 2;
  return col >= startCol && col < startCol + width;
}

export interface RoomConfig {
  cols: number;
  rows: number;
  isValidCell: (row: number, col: number) => boolean;
  hasTopAnchors: boolean;
  /** Anchorless (wallmounted) items need something beneath them — the attic
   * slope has no back wall to hang things on. */
  looseItemsNeedSupport: boolean;
}

const REGULAR_CONFIG: RoomConfig = {
  cols: ROOM_COLS,
  rows: ROOM_ROWS,
  isValidCell: (r, c) => r >= 0 && r < ROOM_ROWS && c >= 0 && c < ROOM_COLS,
  hasTopAnchors: true,
  looseItemsNeedSupport: false,
};

const ATTIC_CONFIG: RoomConfig = {
  cols: ATTIC_COLS,
  rows: ATTIC_ROWS,
  isValidCell: isAtticCellValid,
  hasTopAnchors: false,
  looseItemsNeedSupport: true,
};

export function getRoomConfig(roomIndex: number): RoomConfig {
  return roomIndex === ATTIC_INDEX ? ATTIC_CONFIG : REGULAR_CONFIG;
}

/** Pseudo room index for the whole-house overview. */
export const HOUSE_VIEW = -1;

export function getRoomLabel(roomIndex: number): string {
  if (roomIndex === HOUSE_VIEW) return 'House';
  return roomIndex === ATTIC_INDEX ? 'Attic' : `Room ${roomIndex + 1}`;
}
