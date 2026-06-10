import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface SavegameParseResult {
  ownership: Record<string, number>;
  matched: number;
  unmatchedNames: string[];
}

function parseFurnitureBlob(uint8Array: Uint8Array): { furniture_name: string; quality: number } {
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
  // Quality/rarity field sits right after the name string (0 = normal, 2 = rare)
  const quality = view.getInt32(off, true);
  return { furniture_name, quality };
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
  try {
    const stmt = db.prepare('SELECT key, data FROM furniture');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const blobData = row.data as Uint8Array;
      try {
        const parsed = parseFurnitureBlob(blobData);
        itemCounts.push({ name: parsed.furniture_name, quality: parsed.quality });
      } catch {
        // skip unparseable rows
      }
    }
    stmt.free();
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

  return { ownership, matched, unmatchedNames };
}
