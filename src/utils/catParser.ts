// Parse cat records out of a Mewgenics .sav, adapted from the binary layout
// reverse-engineered in frankieg33/MewgenicsBreedingManager (save_parser.py).
//
// Each row in the `cats` table is an lz4 block prefixed with its uncompressed
// size. The inflated blob is a flat struct we walk field by field. We only read
// the fields useful for breeding: name, sex, the seven base stats, aggression,
// libido, room, and relationships/ancestry (for relatedness checks).

import { lz4DecompressBlock } from './lz4';
import { CAT_STATS } from './breeding';
import type { CatStat } from './breeding';

export type Sex = 'male' | 'female' | '?';

export interface ParsedCat {
  dbKey: number;
  uid: string; // hex of the 64-bit seed
  uidInt: number;
  name: string;
  sex: Sex;
  baseStats: Record<CatStat, number>;
  baseSum: number;
  aggression: number | null; // [0,1] or null if unreadable
  libido: number | null;
  status: 'In House' | 'Adventure' | 'Gone';
  room: string; // game room key (Floor1_Large…) or ''
  /** Parent db_keys from the pedigree blob (authoritative), if known. */
  parents: number[];
  /** Lover db_keys decoded from the relationship slot. */
  loverKeys: number[];
}

class Reader {
  view: DataView;
  bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { return this.bytes[this.pos++]; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u64() { const v = Number(this.view.getBigUint64(this.pos, true)); this.pos += 8; return v; }
  f64() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  skip(n: number) { this.pos += n; }
  /** utf-8 length-prefixed (u64) string; restores pos and returns '' on garbage. */
  str(): string {
    const start = this.pos;
    const len = this.u64();
    if (len < 0 || len > 10000 || this.pos + len > this.bytes.length) { this.pos = start; return ''; }
    const s = UTF8.decode(this.bytes.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  /** utf-16le length-prefixed (u64 char count) string. */
  utf16str(): string {
    const chars = this.u64();
    const byteLen = chars * 2;
    const s = UTF16.decode(this.bytes.subarray(this.pos, this.pos + byteLen));
    this.pos += byteLen;
    return s;
  }
}

const UTF8 = new TextDecoder('utf-8');
const UTF16 = new TextDecoder('utf-16le');

function readPersonality(raw: Uint8Array, view: DataView, anchor: number, offset: number): number | null {
  const i = anchor + offset;
  if (i + 8 > raw.length) return null;
  const v = view.getFloat64(i, true);
  if (!Number.isFinite(v) || v < 0 || v > 1) return null;
  return v;
}

/** db-key candidates at fixed offsets relative to a base (lovers/haters slots). */
function readDbKeys(view: DataView, raw: Uint8Array, selfKey: number, base: number, offsets: number[]): number[] {
  const keys: number[] = [];
  for (const off of offsets) {
    const pos = base + off;
    if (pos < 0 || pos + 4 > raw.length) continue;
    const v = view.getUint32(pos, true);
    if (v === 0 || v === 0xffffffff || v === selfKey) continue;
    if (!keys.includes(v)) keys.push(v);
  }
  return keys;
}

/**
 * Parse one decompressed cat blob's useful fields. Mirrors `Cat.__init__`.
 * Returns null if the core stat block can't be read.
 */
export function parseCatBlob(
  compressed: Uint8Array,
  dbKey: number,
  rooms: Map<number, string>,
  adventureKeys: Set<number>,
): ParsedCat | null {
  try {
    const view0 = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
    const uncompSize = view0.getUint32(0, true);
    const raw = lz4DecompressBlock(compressed.subarray(4), uncompSize);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const r = new Reader(raw);

    r.u32(); // breed_id
    const uidInt = r.u64();
    const name = r.utf16str();
    r.str(); // name_tag (usually empty)
    const anchor = r.pos;

    r.u64(); r.u64(); // fixed-position parent uids (unreliable; pedigree wins)
    r.str(); // collar
    r.u32();
    r.skip(64);
    for (let i = 0; i < 72; i++) r.u32(); // visual mutation table T[72]

    for (let i = 0; i < 3; i++) r.u32(); // gender token fields
    const rawGender = r.str();
    const sexCode = anchor < raw.length ? raw[anchor] : -1;
    const sex: Sex = sexCode === 0 ? 'male' : sexCode === 1 ? 'female' : sexCode === 2 ? '?' : normalizeGender(rawGender);
    r.f64();

    const statBase: number[] = [];
    for (let i = 0; i < 7; i++) statBase.push(r.u32());
    // stat_mod / stat_sec follow but base stats are what breeding uses.

    // Sanity: birth base stats are small integers (game range ~1..7, a little
    // headroom for modified saves). Reject blobs that drift out of alignment.
    if (statBase.some((v) => v < 0 || v > 20)) return null;

    const baseStats = {} as Record<CatStat, number>;
    CAT_STATS.forEach((s, i) => { baseStats[s] = statBase[i]; });
    const baseSum = statBase.reduce((a, b) => a + b, 0);

    const libido = readPersonality(raw, view, anchor, 32);
    const aggression = readPersonality(raw, view, anchor, 64);
    const loverKeys = readDbKeys(view, raw, dbKey, anchor, [48]);

    let status: ParsedCat['status'];
    let room = '';
    if (adventureKeys.has(dbKey)) { status = 'Adventure'; room = 'Adventure'; }
    else if (rooms.has(dbKey)) { status = 'In House'; room = rooms.get(dbKey) || ''; }
    else { status = 'Gone'; }

    return {
      dbKey,
      uid: '0x' + uidInt.toString(16),
      uidInt,
      name: name || `Cat ${dbKey}`,
      sex,
      baseStats,
      baseSum,
      aggression,
      libido,
      status,
      room,
      parents: [],
      loverKeys,
    };
  } catch {
    return null;
  }
}

function normalizeGender(raw: string): Sex {
  const g = (raw || '').trim().toLowerCase();
  if (g.startsWith('m')) return 'male';
  if (g.startsWith('f')) return 'female';
  return '?';
}

// ── house_state: cat_key -> room key ────────────────────────────────────────

export function parseHouseState(blob: Uint8Array): Map<number, string> {
  const result = new Map<number, string>();
  if (blob.length < 8) return result;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const count = view.getUint32(4, true);
  let pos = 8;
  for (let i = 0; i < count; i++) {
    if (pos + 8 > blob.length) break;
    const catKey = view.getUint32(pos, true);
    pos += 8;
    const roomLen = view.getUint32(pos, true);
    pos += 8;
    let room = '';
    if (roomLen > 0 && pos + roomLen <= blob.length) {
      room = UTF8.decode(blob.subarray(pos, pos + roomLen));
      pos += roomLen;
    }
    pos += 24;
    result.set(catKey, room);
  }
  return result;
}

// ── adventure_state: keys of cats out adventuring ───────────────────────────

export function parseAdventureKeys(blob: Uint8Array): Set<number> {
  const keys = new Set<number>();
  if (blob.length < 8) return keys;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const count = view.getUint32(4, true);
  let pos = 8;
  for (let i = 0; i < count; i++) {
    if (pos + 8 > blob.length) break;
    const hi = view.getUint32(pos + 4, true); // cat_key is the high 32 bits
    pos += 8;
    if (hi) keys.add(hi);
  }
  return keys;
}

// ── pedigree blob: child db_key -> [parentA, parentB] ───────────────────────
// The blob is a series of parallel-hashmap tables. The first table holds
// pedigree rows of (cat_key, parent_a, parent_b, coi) as <q q q d> (32 bytes).

const MAX_KEY = 1_000_000;

export function parsePedigree(blob: Uint8Array): Map<number, number[]> {
  const map = new Map<number, number[]>();
  try {
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    if (blob.length < 24) return map;

    const first = view.getBigUint64(0, true);
    let size: bigint, capacity: bigint, tableStart: number;
    if (first < 0xfffffffffffffff5n) {
      size = view.getBigUint64(0, true);
      capacity = view.getBigUint64(8, true);
      tableStart = 16;
    } else {
      size = view.getBigUint64(8, true);
      capacity = view.getBigUint64(16, true);
      tableStart = 24;
    }
    void size;
    const cap = Number(capacity);
    if (cap < 0 || cap > 2_000_000) return map;
    const hashTableSize = cap + 1 + 16;
    if (tableStart + hashTableSize > blob.length) return map;
    const dataStart = tableStart + hashTableSize;
    const ROW = 32;

    for (let i = 0; i < cap; i++) {
      const ctrl = blob[tableStart + i];
      if (ctrl > 0x7f) continue; // empty/deleted slot
      const rowStart = dataStart + i * ROW;
      if (rowStart + ROW > blob.length) break;
      const catKey = Number(view.getBigInt64(rowStart, true));
      const paK = Number(view.getBigInt64(rowStart + 8, true));
      const pbK = Number(view.getBigInt64(rowStart + 16, true));
      if (catKey <= 0 || catKey > MAX_KEY) continue;
      const parents: number[] = [];
      if (paK > 0 && paK <= MAX_KEY && paK !== catKey) parents.push(paK);
      if (pbK > 0 && pbK <= MAX_KEY && pbK !== catKey) parents.push(pbK);
      map.set(catKey, parents);
    }
  } catch {
    /* best-effort */
  }
  return map;
}
