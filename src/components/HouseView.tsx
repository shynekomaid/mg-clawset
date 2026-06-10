import type { CSSProperties } from 'react';
import type { PlacedFurniture } from '../types/furniture';
import { getRoomConfig, getRoomLabel, ATTIC_INDEX } from '../types/furniture';
import { getVisualBounds, getImageAlignment } from '../utils/gridHelpers';

interface Props {
  rooms: PlacedFurniture[][];
  isRoomUnlocked: (i: number) => boolean;
  onSelectRoom: (i: number) => void;
}

function MiniRoom({ roomIndex, placed, unlocked, onSelect }: {
  roomIndex: number;
  placed: PlacedFurniture[];
  unlocked: boolean;
  onSelect: () => void;
}) {
  const cfg = getRoomConfig(roomIndex);

  const wrapper: CSSProperties = {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    border: `1px solid ${unlocked ? 'var(--border)' : 'transparent'}`,
    borderRadius: 10,
    padding: 8,
    background: 'var(--social-bg)',
    cursor: unlocked ? 'pointer' : 'default',
    opacity: unlocked ? 1 : 0.45,
  };

  return (
    <div
      style={wrapper}
      onClick={unlocked ? onSelect : undefined}
      title={unlocked ? `Open ${getRoomLabel(roomIndex)}` : `${getRoomLabel(roomIndex)} is not yet unlocked in game`}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-h)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
        <span>{getRoomLabel(roomIndex)}</span>
        <span style={{ color: 'var(--text-m)', fontWeight: 400 }}>
          {unlocked ? `${placed.length} item${placed.length !== 1 ? 's' : ''}` : '🔒 locked'}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        position: 'relative',
        aspectRatio: `${cfg.cols} / ${cfg.rows}`,
        maxWidth: '100%',
        maxHeight: '100%',
        width: '100%',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cfg.cols}, 1fr)`,
          gridTemplateRows: `repeat(${cfg.rows}, 1fr)`,
          gap: 1,
          width: '100%',
          height: '100%',
        }}>
          {Array.from({ length: cfg.rows }, (_, r) =>
            Array.from({ length: cfg.cols }, (_, c) => {
              const valid = cfg.isValidCell(r, c);
              return (
                <div
                  key={`${r}-${c}`}
                  style={{
                    borderRadius: 1,
                    background: valid ? 'var(--code-bg)' : 'transparent',
                    border: valid ? '1px solid var(--border)' : 'none',
                  }}
                />
              );
            }),
          )}
        </div>
        {/* Furniture images, same placement math as the full room grid */}
        {placed.map((p) => {
          const { minR, maxR, minC, maxC } = getVisualBounds(p.item.shape);
          const visualRows = maxR - minR + 1;
          const visualCols = maxC - minC + 1;
          const anchorAlign = getImageAlignment(p.item.shape);
          const fillHeight = anchorAlign === 'top' || anchorAlign === 'bottom';
          const src = p.item.image_url.startsWith('public/') ? p.item.image_url.slice(6) : p.item.image_url;
          return (
            <div
              key={p.instanceId}
              style={{
                position: 'absolute',
                left: `${((p.col + minC) / cfg.cols) * 100}%`,
                top: `${((p.row + minR) / cfg.rows) * 100}%`,
                width: `${(visualCols / cfg.cols) * 100}%`,
                height: `${(visualRows / cfg.rows) * 100}%`,
                display: 'flex',
                alignItems: anchorAlign === 'bottom' ? 'flex-end' : anchorAlign === 'top' ? 'flex-start' : 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
              title={p.item.name}
            >
              <img
                src={src}
                alt={p.item.name}
                draggable={false}
                style={{
                  height: '100%',
                  width: fillHeight ? 'auto' : '100%',
                  maxWidth: fillHeight ? 'none' : '100%',
                  objectFit: fillHeight ? undefined : 'contain',
                }}
              />
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

/**
 * Whole-house overview in the game's arrangement: attic on top,
 * Room 4 / Room 3 above Room 1 / Room 2 (matches the house image export).
 * Click a room to open it in the designer.
 */
export default function HouseView({ rooms, isRoomUnlocked, onSelectRoom }: Props) {
  const mini = (i: number) => (
    <MiniRoom
      roomIndex={i}
      placed={rooms[i]}
      unlocked={isRoomUnlocked(i)}
      onSelect={() => onSelectRoom(i)}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      <div style={{ flex: '1.1 1 0%', minHeight: 0, display: 'flex' }}>
        {mini(ATTIC_INDEX)}
      </div>
      <div style={{ display: 'flex', gap: 10, flex: '1 1 0%', minHeight: 0 }}>
        {mini(3)}
        {mini(2)}
      </div>
      <div style={{ display: 'flex', gap: 10, flex: '1 1 0%', minHeight: 0 }}>
        {mini(0)}
        {mini(1)}
      </div>
    </div>
  );
}
