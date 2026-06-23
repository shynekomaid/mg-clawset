import type { CSSProperties } from 'react';
import type { PlacedFurniture } from '../types/furniture';
import { getRoomConfig, getRoomLabel, ATTIC_INDEX } from '../types/furniture';
import { getVisualBounds, getImageAlignment } from '../utils/gridHelpers';

interface Props {
  rooms: PlacedFurniture[][];
  isRoomUnlocked: (i: number) => boolean;
  onSelectRoom: (i: number) => void;
  labelNumbers?: Record<string, number> | null;
  hoverItemId?: string | null;
  onHoverItem?: (id: string | null) => void;
  /** Click on a piece: open its room with the checklist focused on it. */
  onSelectItem?: (roomIndex: number, itemId: string) => void;
}

function MiniRoom({ roomIndex, placed, unlocked, onSelect, labelNumbers, hoverItemId, onHoverItem, onSelectItem }: {
  roomIndex: number;
  placed: PlacedFurniture[];
  unlocked: boolean;
  onSelect: () => void;
  labelNumbers?: Record<string, number> | null;
  hoverItemId?: string | null;
  onHoverItem?: (id: string | null) => void;
  onSelectItem?: (roomIndex: number, itemId: string) => void;
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
        {unlocked && (
          <span style={{ color: 'var(--text-m)', fontWeight: 400 }}>
            {placed.length} item{placed.length !== 1 ? 's' : ''}
          </span>
        )}
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
          const isHovered = hoverItemId === p.item.id;
          return (
            <div
              key={p.instanceId}
              data-piece-id={p.item.id}
              onMouseEnter={() => onHoverItem?.(p.item.id)}
              onMouseLeave={() => onHoverItem?.(null)}
              onClick={onSelectItem ? (e) => {
                e.stopPropagation();
                onSelectItem(roomIndex, p.item.id);
              } : undefined}
              style={{
                position: 'absolute',
                left: `${((p.col + minC) / cfg.cols) * 100}%`,
                top: `${((p.row + minR) / cfg.rows) * 100}%`,
                width: `${(visualCols / cfg.cols) * 100}%`,
                height: `${(visualRows / cfg.rows) * 100}%`,
                display: 'flex',
                alignItems: anchorAlign === 'bottom' ? 'flex-end' : anchorAlign === 'top' ? 'flex-start' : 'center',
                justifyContent: 'center',
                outline: isHovered ? '2px solid var(--accent)' : 'none',
                borderRadius: 3,
                background: isHovered ? 'rgba(193,73,83,0.12)' : 'transparent',
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
              {labelNumbers?.[p.item.id] && (
                <span style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  background: isHovered ? 'var(--accent)' : 'rgba(0,0,0,0.7)',
                  color: '#fff',
                  borderRadius: 3,
                  fontSize: 8,
                  fontWeight: 700,
                  padding: '0 3px',
                  lineHeight: '11px',
                  pointerEvents: 'none',
                }}>
                  {labelNumbers[p.item.id]}
                </span>
              )}
            </div>
          );
        })}
        {!unlocked && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--text-m)',
            textAlign: 'center',
          }}>
Locked — not yet unlocked in game
          </div>
        )}
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
export default function HouseView({ rooms, isRoomUnlocked, onSelectRoom, labelNumbers, hoverItemId, onHoverItem, onSelectItem }: Props) {
  const mini = (i: number) => (
    <MiniRoom
      roomIndex={i}
      placed={rooms[i]}
      unlocked={isRoomUnlocked(i)}
      onSelect={() => onSelectRoom(i)}
      labelNumbers={labelNumbers}
      hoverItemId={hoverItemId}
      onHoverItem={onHoverItem}
      onSelectItem={onSelectItem}
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
