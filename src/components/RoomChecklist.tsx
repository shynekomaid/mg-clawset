import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture } from '../types/furniture';
import { getRoomLabel } from '../types/furniture';
import FurnitureImage from './FurnitureImage';

const CHECKLIST_KEY = 'mg-clawset-checklist';

function loadChecked(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKLIST_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

interface Entry {
  item: FurnitureItem;
  count: number;
}

interface Props {
  placed: PlacedFurniture[];
  roomIndex: number;
  /** itemId -> legend number shown when labels are on. */
  numbers?: Record<string, number> | null;
}

/**
 * Aggregated list of the active room's furniture so it can be ticked off
 * while placing the items in the actual game. Checked state is persisted
 * per room + item in localStorage.
 */
export default function RoomChecklist({ placed, roomIndex, numbers }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(loadChecked);

  const entries: Entry[] = useMemo(() => {
    const byId = new Map<string, Entry>();
    for (const p of placed) {
      const e = byId.get(p.item.id);
      if (e) e.count += 1;
      else byId.set(p.item.id, { item: p.item, count: 1 });
    }
    return [...byId.values()].sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [placed]);

  const toggle = (itemId: string) => {
    const key = `${roomIndex}:${itemId}`;
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next));
      return next;
    });
  };

  const doneCount = entries.filter((e) => checked[`${roomIndex}:${e.item.id}`]).length;

  const panelStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: 250,
    flexShrink: 0,
    minHeight: 0,
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 10,
    background: 'var(--social-bg)',
  };

  const rowStyle = (isChecked: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: isChecked ? 'var(--text-m)' : 'var(--text)',
    textDecoration: isChecked ? 'line-through' : 'none',
    opacity: isChecked ? 0.6 : 1,
    cursor: 'pointer',
    padding: '2px 0',
  });

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-h)' }}>
        {getRoomLabel(roomIndex)} checklist
      </div>
      {entries.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-m)' }}>
          Room is empty — place or auto-fill furniture first.
        </div>
      ) : (
        <>
          <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {entries.map((e) => {
              const isChecked = !!checked[`${roomIndex}:${e.item.id}`];
              return (
                <label key={e.item.id} style={rowStyle(isChecked)}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(e.item.id)}
                  />
                  {numbers?.[e.item.id] && (
                    <span style={{ background: 'rgba(0,0,0,0.7)', color: '#fff', borderRadius: 4, fontSize: 10, fontWeight: 700, padding: '0 5px', lineHeight: '15px', flexShrink: 0 }}>
                      {numbers[e.item.id]}
                    </span>
                  )}
                  <FurnitureImage src={e.item.image_url} alt={e.item.name} compact />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {e.count > 1 ? `${e.count}× ` : ''}{e.item.name}
                  </span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-m)', borderTop: '1px solid var(--border)', paddingTop: 6 }}>
            {doneCount} of {entries.length} placed in game
          </div>
        </>
      )}
    </div>
  );
}
