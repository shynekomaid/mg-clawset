import type { CSSProperties } from 'react';
import type { PlacedFurniture, StatKey } from '../types/furniture';
import { getRoomLabel } from '../types/furniture';
import StatIcon from './StatIcon';
import { STAT_COLORS } from '../utils/statColors';

const STATS: { key: StatKey; label: string }[] = [
  { key: 'appeal', label: 'APL' },
  { key: 'comfort', label: 'CMF' },
  { key: 'stimulation', label: 'STM' },
  { key: 'health', label: 'HLT' },
  { key: 'mutation', label: 'MUT' },
];

function computeTotals(placed: PlacedFurniture[]): Record<StatKey, number> {
  const totals: Record<StatKey, number> = { appeal: 0, comfort: 0, stimulation: 0, health: 0, mutation: 0 };
  for (const p of placed) {
    for (const s of STATS) totals[s.key] += p.item[s.key];
  }
  return totals;
}

const rowBase: CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '4px 10px',
  borderRadius: 8,
  alignItems: 'center',
  minWidth: 0,
  transition: 'background 0.25s ease, border-color 0.25s ease, padding 0.25s ease, font-size 0.25s ease',
  flexWrap: 'wrap',
};

const statStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontFamily: 'var(--font)',
};

const valueStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  minWidth: 20,
  textAlign: 'center',
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  minWidth: 52,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
};

const countStyle: CSSProperties = {
  color: 'var(--lavender-grey)',
  fontSize: 11,
  marginLeft: 'auto',
  whiteSpace: 'nowrap',
};

function valueColor(v: number, stat: StatKey): string {
  return v > 0 ? STAT_COLORS[stat] : v < 0 ? 'var(--lavender-grey)' : 'var(--text-h)';
}

function StatRow({ label, totals, count, active, highlight, onClick }: {
  label: string;
  totals: Record<StatKey, number>;
  count: string;
  active?: boolean;
  highlight?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      style={{
        ...rowBase,
        padding: active ? '8px 10px' : '4px 10px',
        background: active ? 'var(--accent-bg)' : highlight ? 'var(--social-bg)' : 'transparent',
        border: active ? '1px solid var(--accent)' : '1px solid transparent',
        cursor: onClick ? 'pointer' : undefined,
      }}
      onClick={onClick}
    >
      <span style={{
        ...labelStyle,
        color: active ? 'var(--accent)' : 'var(--text)',
        fontSize: active ? 13 : 11,
        transition: 'font-size 0.25s ease',
      }}>{label}</span>
      {STATS.map((s) => (
        <div key={s.key} style={statStyle}>
          <StatIcon stat={s.key} size={active ? 16 : 14} />
          <span style={{
            ...valueStyle,
            fontSize: active ? 15 : 13,
            transition: 'font-size 0.25s ease',
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
}

export default function RoomStatsSummary({ rooms, activeRoom, onActiveRoomChange, ownership, isRoomUnlocked }: Props) {
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
        return (
          <StatRow
            key={i}
            label={getRoomLabel(i)}
            totals={totals}
            count={`${room.length} item${room.length !== 1 ? 's' : ''}`}
            active={i === activeRoom}
            onClick={() => onActiveRoomChange(i)}
          />
        );
      })}
    </div>
  );
}
