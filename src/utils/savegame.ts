import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { parseCatBlob, parseHouseState, parseAdventureKeys, parsePedigree } from './catParser';
import type { ParsedCat } from './catParser';

export interface HouseInfo {
  atticUnlocked: boolean;
  /** Number of unlocked regular rooms (1-4). */
  regularRooms: number;
}

/** One item placed on a room grid in the game. row/col = top-left SOLID cell (or the anchor-point cell for attached trinkets). */
export interface SavedPlacement {
  itemId: string;
  roomIndex: number;
  col: number;
  row: number;
  /** In-game placement order; supporters come before the items attached to them. */
  order: number;
}

export interface SavegameParseResult {
  ownership: Record<string, number>;
  matched: number;
  unmatchedNames: string[];
  houseInfo: HouseInfo | null;
  placements: SavedPlacement[];
  /** Cats read from the save (empty if the save has no cats table). */
  cats: ParsedCat[];
}

/**
 * Game room name -> app room index. Floor1 = lower floor, Floor2 = upper
 * (mirrors the house image layout: Room1/2 bottom, Room3/4 top).
 */
const ROOM_NAME_TO_INDEX: Record<string, number> = {
  Floor1_Large: 0,
  Floor1_Small: 1,
  Floor2_Large: 2,
  Floor2_Small: 3,
  Attic: 4,
};

/**
 * Convert game placement coords to app grid cells. x = leftmost solid
 * column. y semantics differ by anchor direction (floor items at y=-11,
 * ceiling-hung items at y=-5): callers map bottom-anchored items via the
 * bottom solid row and hanging/wall items via the top solid row.
 */
export function gameCoordsToCell(roomIndex: number, x: number, y: number): { col: number; row: number } {
  if (roomIndex === 4) return { col: x + 8, row: -y - 4 };
  return { col: x + 10, row: -y - 5 };
}

/**
 * files.house_unlocks blob: int32 version, then length-prefixed (int64) strings:
 * current house name followed by a count and that many unlock entries, e.g.
 * "Default", "SmallHouse_Attic", "MediumHouse", "MediumHouse_SmallRoom".
 * Every non-attic entry corresponds to one unlocked regular room.
 */
function parseHouseUnlocks(blob: Uint8Array): HouseInfo | null {
  try {
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const decoder = new TextDecoder('utf-8');
    let off = 4; // version
    const readStr = (): string => {
      const len = Number(view.getBigInt64(off, true));
      off += 8;
      const str = decoder.decode(blob.slice(off, off + len));
      off += len;
      return str;
    };
    readStr(); // current house name, e.g. "House2"
    const count = Number(view.getBigInt64(off, true));
    off += 8;
    if (count < 0 || count > 32) return null;
    const entries: string[] = [];
    for (let i = 0; i < count; i++) entries.push(readStr());
    const atticUnlocked = entries.some((e) => e.toLowerCase().includes('attic'));
    // "Default" = the base room. Plain house-size upgrades ("MediumHouse")
    // add no room by themselves; only suffixed entries do
    // ("MediumHouse_SmallRoom"). Attic suffixes are tracked separately.
    const roomAdditions = entries.filter((e) => {
      const m = e.match(/_([A-Za-z0-9]+)$/);
      return m !== null && !m[1].toLowerCase().includes('attic');
    }).length;
    const regularRooms = Math.min(4, Math.max(1, 1 + roomAdditions));
    return { atticUnlocked, regularRooms };
  } catch {
    return null;
  }
}

interface FurnitureRow {
  furniture_name: string;
  quality: number;
  room: string;
  x: number;
  y: number;
  z: number;
}

/**
 * furniture.data blob: int32 field1, int32 name_len, int32 pad, name,
 * int64 quality (0 normal / 2 rare), int64 room_len + room (empty when
 * stored), then int32 x, int32 y, int32 stack-order, ...
 */
function parseFurnitureBlob(uint8Array: Uint8Array): FurnitureRow {
  const view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
  const decoder = new TextDecoder('utf-8');
  let off = 0;
  off += 4; // field1
  const name_len = view.getInt32(off, true);
  off += 4;
  off += 4; // padding
  const nameBytes = uint8Array.slice(off, off + name_len);
  const furniture_name = decoder.decode(nameBytes);
  off += name_len;
  const quality = Number(view.getBigInt64(off, true));
  off += 8;
  const room_len = Number(view.getBigInt64(off, true));
  off += 8;
  let room = '';
  if (room_len > 0 && room_len < 32 && off + room_len <= uint8Array.byteLength) {
    room = decoder.decode(uint8Array.slice(off, off + room_len));
    off += room_len;
  }
  let x = 0;
  let y = 0;
  let z = 0;
  if (off + 12 <= uint8Array.byteLength) {
    x = view.getInt32(off, true);
    y = view.getInt32(off + 4, true);
    z = view.getInt32(off + 8, true);
  }
  return { furniture_name, quality, room, x, y, z };
}

function resolveItemId(name: string, quality: number, furnitureIdMap: Map<string, string>): string | undefined {
  const resolvedName = quality >= 2 ? `${name}_(Rare)` : name;
  return furnitureIdMap.get(resolvedName.toLowerCase());
}

/** Parse a Mewgenics .sav (SQLite) into ownership counts keyed by app furniture id. */
export async function parseSavegame(
  data: Uint8Array,
  furnitureIdMap: Map<string, string>,
): Promise<SavegameParseResult> {
  const SQL = await initSqlJs({
    locateFile: () => sqlWasmUrl,
  });

  const db = new SQL.Database(data);
  const itemCounts: { name: string; quality: number }[] = [];
  const placements: SavedPlacement[] = [];
  let houseInfo: HouseInfo | null = null;
  let cats: ParsedCat[] = [];
  try {
    const stmt = db.prepare('SELECT key, data FROM furniture');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const blobData = row.data as Uint8Array;
      try {
        const parsed = parseFurnitureBlob(blobData);
        itemCounts.push({ name: parsed.furniture_name, quality: parsed.quality });
        if (parsed.room && parsed.room in ROOM_NAME_TO_INDEX) {
          const roomIndex = ROOM_NAME_TO_INDEX[parsed.room];
          const { col, row: gridRow } = gameCoordsToCell(roomIndex, parsed.x, parsed.y);
          const itemId = resolveItemId(parsed.furniture_name, parsed.quality, furnitureIdMap);
          if (itemId) placements.push({ itemId, roomIndex, col, row: gridRow, order: parsed.z });
        }
      } catch {
        // skip unparseable rows
      }
    }
    stmt.free();

    const readFile = (key: string): Uint8Array | null => {
      try {
        const st = db.prepare('SELECT data FROM files WHERE key = ?');
        st.bind([key]);
        let out: Uint8Array | null = null;
        if (st.step()) out = st.getAsObject().data as Uint8Array;
        st.free();
        return out;
      } catch {
        return null;
      }
    };

    const houseUnlocks = readFile('house_unlocks');
    if (houseUnlocks) houseInfo = parseHouseUnlocks(houseUnlocks);

    // Cats: room/adventure/pedigree context first, then each lz4 cat blob.
    try {
      const houseState = readFile('house_state');
      const adventureState = readFile('adventure_state');
      const pedigree = readFile('pedigree');
      const rooms = houseState ? parseHouseState(houseState) : new Map<number, string>();
      const adventureKeys = adventureState ? parseAdventureKeys(adventureState) : new Set<number>();
      const pedMap = pedigree ? parsePedigree(pedigree) : new Map<number, number[]>();

      const cs = db.prepare('SELECT key, data FROM cats');
      while (cs.step()) {
        const row = cs.getAsObject();
        const cat = parseCatBlob(row.data as Uint8Array, row.key as number, rooms, adventureKeys);
        if (cat) {
          cat.parents = pedMap.get(cat.dbKey) ?? [];
          cats.push(cat);
        }
      }
      cs.free();
    } catch {
      // saves without a cats table (or an unexpected layout) just yield no cats
      cats = [];
    }
  } finally {
    db.close();
  }

  // Aggregate counts per resolved name (base name or rare variant)
  const nameCounts: Record<string, number> = {};
  for (const { name, quality } of itemCounts) {
    // quality 0 = normal, 2 = rare
    const resolvedName = quality >= 2 ? `${name}_(Rare)` : name;
    nameCounts[resolvedName] = (nameCounts[resolvedName] || 0) + 1;
  }

  // Map save file names to app IDs
  const ownership: Record<string, number> = {};
  let matched = 0;
  const unmatchedNames: string[] = [];

  for (const [name, count] of Object.entries(nameCounts)) {
    const id = furnitureIdMap.get(name.toLowerCase());
    if (id) {
      ownership[id] = (ownership[id] || 0) + count;
      matched++;
    } else {
      unmatchedNames.push(name);
    }
  }

  return { ownership, matched, unmatchedNames, houseInfo, placements, cats };
}
