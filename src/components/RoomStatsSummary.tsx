import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomConfig, getRoomLabel } from '../types/furniture';
import StatIcon from './StatIcon';
import { STAT_COLORS } from '../utils/statColors';

const STATS: { key: StatKey; label: string }[] = [
  { key: 'appeal', label: 'APL' },
  { key: 'comfort', label: 'CMF' },
  { key: 'stimulation', label: 'STM' },
  { key: 'health', label: 'HLT' },
  { key: 'mutation', label: 'MUT' },
];

const FOCUS_LABELS: Record<StatKey, string> = {
  appeal: 'Appeal',
  comfort: 'Comfort',
  stimulation: 'Stimulation',
  health: 'Health',
  mutation: 'Mutation',
};

/**
 * Convert per-room weights to a compact focus string.
 * e.g. { stimulation: 1, comfort: -1 } → "Stim↑, Comf↓"
 *      { comfort: -2 }              → "No Comfort"
 *      {}                           → (blank)
 */
function focusString(weights?: Record<StatKey, -2 | -1 | 0 | 1>): string {
  if (!weights) return '';
  const parts: string[] = [];
  for (const [stat, w] of Object.entries(weights) as [StatKey, -2 | -1 | 0 | 1][]) {
    if (w === 1) parts.push(`${FOCUS_LABELS[stat]}↑`);
    else if (w === -1) parts.push(`${FOCUS_LABELS[stat]}↓`);
    else if (w === -2) parts.push(`No ${FOCUS_LABELS[stat]}`);
  }
  return parts.join(' · ');
}

function computeTotals(placed: PlacedFurniture[]): Record<StatKey, number> {
  const totals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  for (const p of placed) {
    for (const s of STATS) totals[s.key] += p.item[s.key];
  }
  return totals;
}

const rowBase: CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  alignItems: 'center',
  minWidth: 0,
  transition: 'background 0.25s ease, border-color 0.25s ease, padding 0.25s ease',
  flexWrap: 'wrap',
};

const statStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 11,
  fontFamily: 'var(--font)',
};

const valueStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  minWidth: 16,
  textAlign: 'center',
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  minWidth: 42,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
};

const countStyle: CSSProperties = {
  color: 'var(--lavender-grey)',
  fontSize: 10,
  marginLeft: 'auto',
  whiteSpace: 'nowrap',
};

function valueColor(v: number, stat: StatKey): string {
  return v > 0 ? STAT_COLORS[stat] : v < 0 ? 'var(--lavender-grey)' : 'var(--text-h)';
}

function StatRow({ label, totals, count, active, highlight, onClick, variant }: {
  label: string;
  totals: Record<StatKey, number>;
  count: string;
  active?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  variant?: 'default' | 'max';
}) {
  const isMax = variant === 'max';
  return (
    <div
      style={{
        ...rowBase,
        padding: active ? '5px 8px' : '2px 8px',
        background: active ? 'var(--accent-bg)' : isMax ? 'var(--bg-secondary)' : highlight ? 'var(--social-bg)' : 'transparent',
        border: isMax ? '1px dashed var(--border)' : active ? '1px solid var(--accent)' : '1px solid transparent',
        cursor: onClick ? 'pointer' : undefined,
        opacity: isMax && !active ? 0.8 : undefined,
      }}
      onClick={onClick}
    >
      <span style={{
        ...labelStyle,
        color: active ? 'var(--accent)' : 'var(--text)',
      }}>{label}</span>
      {STATS.map((s) => (
        <div key={s.key} style={statStyle}>
          <StatIcon stat={s.key} size={active ? 14 : 12} />
          <span style={{
            ...valueStyle,
            color: valueColor(totals[s.key], s.key),
          }}>
            {totals[s.key]}
          </span>
        </div>
      ))}
      <span style={countStyle}>{count}</span>
    </div>
  );
}

interface Props {
  rooms: PlacedFurniture[][];
  activeRoom: number;
  onActiveRoomChange: (i: number) => void;
  ownership: Record<string, number>;
  isRoomUnlocked: (i: number) => boolean;
  /** Per-room stat weights — used to show focus labels. */
  roomWeights?: Record<number, Record<StatKey, -2 | -1 | 0 | 1>>;
  /** Per-room function label (preset name or "Custom") — shown after stats. */
  roomFunctions?: Record<number, string>;
  /** Fill order — room index appears at position → shows "#N fill". */
  priorityOrder?: number[];
  /** Full furniture catalog — used to compute theoretical max per stat. */
  allFurniture?: FurnitureItem[];
}

export default function RoomStatsSummary({ rooms, activeRoom, onActiveRoomChange, ownership, isRoomUnlocked, roomWeights, roomFunctions, priorityOrder, allFurniture }: Props) {
  // House totals
  const houseTotals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  let totalItems = 0;
  const usedCounts: Record<string, number> = {};

  for (const room of rooms) {
    const rt = computeTotals(room);
    for (const s of STATS) houseTotals[s.key] += rt[s.key];
    totalItems += room.length;
    for (const p of room) {
      usedCounts[p.item.id] = (usedCounts[p.item.id] || 0) + 1;
    }
  }

  // Count missing: items placed but not enough owned
  let missing = 0;
  for (const [id, used] of Object.entries(usedCounts)) {
    const owned = ownership[id] || 0;
    if (used > owned) missing += used - owned;
  }

  // Theoretical max per stat.
  // Appeal = fill the whole house with positive-appeal items.
  // Other stats = fill just the Attic (136 cells) with items good at that stat.
  const maxTotals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  if (allFurniture) {
    const atticCfg = getRoomConfig(4);
    let atticCells = 0;
    for (let r = 0; r < atticCfg.rows; r++) {
      for (let c = 0; c < atticCfg.cols; c++) if (atticCfg.isValidCell(r, c)) atticCells++;
    }

    for (const s of STATS) {
      const capacity = s.key === 'appeal' ? (() => {
        let cap = 0;
        for (const ri of [0, 1, 2, 3, 4]) {
          const cfg = getRoomConfig(ri);
          for (let r = 0; r < cfg.rows; r++)
            for (let c = 0; c < cfg.cols; c++)
              if (cfg.isValidCell(r, c)) cap++;
        }
        return cap;
      })() : atticCells;

      const pool: { item: FurnitureItem; owned: number; ratio: number }[] = [];
      for (const item of allFurniture) {
        const cnt = ownership[item.id] ?? 0;
        if (cnt <= 0 || item[s.key] <= 0) continue;
        pool.push({ item, owned: cnt, ratio: item[s.key] / item.spacesOccupied });
      }
      pool.sort((a, b) => b.ratio - a.ratio || b.item[s.key] - a.item[s.key]);

      let filled = 0;
      let total = 0;
      for (const entry of pool) {
        const maxFit = Math.floor((capacity - filled) / entry.item.spacesOccupied);
        const take = Math.min(entry.owned, maxFit);
        if (take <= 0) continue;
        total += take * entry.item[s.key];
        filled += take * entry.item.spacesOccupied;
        if (filled >= capacity) break;
      }
      maxTotals[s.key] = total;
    }
  }

  const maxRow = allFurniture ? (
    <div style={{ marginTop: 2 }}>
      <div style={{ height: 1, background: 'var(--border)', margin: '4px 0 2px', opacity: 0.4 }} />
      <StatRow label="Max" totals={maxTotals} count="theoretical max" variant="max" />
    </div>
  ) : null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      flex: '1 1 0%',
      minWidth: 0,
    }}>
      <StatRow
        label="House"
        totals={houseTotals}
        count={`${totalItems} total${missing > 0 ? ` · ${missing} missing` : ''}`}
        highlight
        active={activeRoom === -1}
        onClick={() => onActiveRoomChange(-1)}
      />
      <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
      {/* game order: attic on top, then the floor rooms */}
      {[4, 0, 1, 2, 3].filter((i) => i < rooms.length).map((i) => {
        const room = rooms[i];
        if (!isRoomUnlocked(i)) {
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 8px', fontSize: 11, color: 'var(--text-m)', opacity: 0.55 }}>
              <span style={{ fontWeight: 600, minWidth: 48 }}>{getRoomLabel(i)}</span>
              <span>Locked — not yet unlocked in game</span>
            </div>
          );
        }
        const totals = computeTotals(room);
        const focus = focusString(roomWeights?.[i]);
        const fn = roomFunctions?.[i];
        const pri = priorityOrder ? priorityOrder.indexOf(i) + 1 : 0;
        const meta = [
          `${room.length} item${room.length !== 1 ? 's' : ''}`,
          focus,
          pri ? `#${pri}` : '',
          fn ?? '',
        ].filter(Boolean).join(' · ');
        return (
          <StatRow
            key={i}
            label={getRoomLabel(i)}
            totals={totals}
            count={meta}
            active={i === activeRoom}
            onClick={() => onActiveRoomChange(i)}
          />
        );
      })}
      {maxRow}
    </div>
  );
}
