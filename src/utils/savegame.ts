import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface HouseInfo {
  atticUnlocked: boolean;
  /** Number of unlocked regular rooms (1-4). */
  regularRooms: number;
}

/** One item placed on a room grid in the game. row/col = bottom-left SOLID cell. */
export interface SavedPlacement {
  itemId: string;
  roomIndex: number;
  col: number;
  row: number;
}

export interface SavegameParseResult {
  ownership: Record<string, number>;
  matched: number;
  unmatchedNames: string[];
  houseInfo: HouseInfo | null;
  placements: SavedPlacement[];
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
 * Convert game placement coords to app grid cells (derived from a
 * controlled save: crystal ball at attic bottom-left = (-8,-10),
 * food boxes at Floor1_Small left wall rows 6..1 = (-10,-11..-6)).
 */
function gameCoordsToCell(roomIndex: number, x: number, y: number): { col: number; row: number } {
  if (roomIndex === 4) return { col: x + 8, row: -y - 3 };
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
    const regularRooms = Math.min(4, Math.max(1, entries.filter((e) => !e.toLowerCase().includes('attic')).length));
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
  if (off + 8 <= uint8Array.byteLength) {
    x = view.getInt32(off, true);
    y = view.getInt32(off + 4, true);
  }
  return { furniture_name, quality, room, x, y };
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
          if (itemId) placements.push({ itemId, roomIndex, col, row: gridRow });
        }
      } catch {
        // skip unparseable rows
      }
    }
    stmt.free();

    try {
      const hs = db.prepare("SELECT data FROM files WHERE key = 'house_unlocks'");
      if (hs.step()) {
        houseInfo = parseHouseUnlocks(hs.getAsObject().data as Uint8Array);
      }
      hs.free();
    } catch {
      // older saves / synthetic files may lack the files table
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

  return { ownership, matched, unmatchedNames, houseInfo, placements };
}
