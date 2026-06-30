import { useState, useMemo, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { FurnitureItem, PlacedFurniture, RoomConfig } from '../types/furniture';
import { getRoomConfig, getRoomLabel, ATTIC_INDEX } from '../types/furniture';
import { getVisualBounds, getImageAlignment } from '../utils/gridHelpers';
import { SVG_NEEDS_ROTATION } from '../utils/rotationAssets';

const IDOL_RE = /special_\w*(idol)/i;
function isIdol(item: FurnitureItem): boolean {
  return IDOL_RE.test(item.image_url);
}

function isFoodBox(item: FurnitureItem): boolean {
  return item.image_url.includes('special_foodbox');
}

const HV_CELL_COLORS: Record<number, string> = {
  1: 'transparent',
  2: 'var(--lavender-grey)',
  3: 'var(--blushed-brick)',
  4: 'var(--sand-dune)',
  5: 'var(--charcoal)',
};

const HV_CELL_BORDERS: Record<number, string> = {
  2: 'rgba(132,143,165,0.5)',
  3: 'rgba(193,73,83,0.5)',
  4: 'rgba(229,220,197,0.5)',
  5: 'rgba(76,76,71,0.5)',
};

function buildHVShapeTypeGrid(placed: PlacedFurniture[], cfg: RoomConfig): (number | null)[][] {
  const grid: (number | null)[][] = Array.from({ length: cfg.rows }, () =>
    Array.from({ length: cfg.cols }, () => null),
  );
  for (const p of placed) {
    for (let r = 0; r < p.item.shape.length; r++) {
      for (let c = 0; c < p.item.shape[r].length; c++) {
        const t = p.item.shape[r][c];
        if (t !== 1) {
          const gr = p.row + r;
          const gc = p.col + c;
          if (gr >= 0 && gr < cfg.rows && gc >= 0 && gc < cfg.cols) {
            grid[gr][gc] = t;
          }
        }
      }
    }
  }
  return grid;
}

/** Fits a `cols×rows` grid into `availW × availH` with square cells. */
function fitGrid(availW: number, availH: number, cols: number, rows: number) {
  const aspect = cols / rows;
  let w: number, h: number;
  if (availW / availH > aspect) {
    h = availH;
    w = h * aspect;
  } else {
    w = availW;
    h = w / aspect;
  }
  return { w: Math.floor(w), h: Math.floor(h) };
}

interface Props {
  rooms: PlacedFurniture[][];
  isRoomUnlocked: (i: number) => boolean;
  onSelectRoom: (i: number) => void;
  labelNumbers?: Record<string, number> | null;
  hoverItemId?: string | null;
  onHoverItem?: (id: string | null) => void;
  /** Click on a piece: open its room with the checklist focused on it. */
  onSelectItem?: (roomIndex: number, itemId: string) => void;
  expertView?: boolean;
  checklistOpen?: boolean;
}

function MiniRoom({ roomIndex, placed, unlocked, onSelect, labelNumbers, hoverItemId, onHoverItem, onSelectItem, expertView, checklistOpen = false }: {
  roomIndex: number;
  placed: PlacedFurniture[];
  unlocked: boolean;
  onSelect: () => void;
  labelNumbers?: Record<string, number> | null;
  hoverItemId?: string | null;
  onHoverItem?: (id: string | null) => void;
  onSelectItem?: (roomIndex: number, itemId: string) => void;
  expertView?: boolean;
  checklistOpen?: boolean;
}) {
  const cfg = getRoomConfig(roomIndex);

  const totalCells = useMemo(() => {
    let cnt = 0;
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        if (cfg.isValidCell(r, c)) cnt++;
      }
    }
    return cnt;
  }, [cfg.rows, cfg.cols]);

  const occupiedCells = useMemo(
    () => placed.reduce((s, p) => s + p.item.spacesOccupied, 0),
    [placed],
  );

  const shapeTypeGrid = useMemo(
    () => expertView ? buildHVShapeTypeGrid(placed, cfg) : null,
    [expertView, placed, cfg],
  );

  const gridAreaRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = gridAreaRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setGridSize(fitGrid(rect.width, rect.height, cfg.cols, cfg.rows));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cfg.cols, cfg.rows]);

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
            <span title="Items placed">{placed.length}</span>
            {' · '}
            <span title="Cells occupied / total">{occupiedCells}/{totalCells}</span>
          </span>
        )}
      </div>
      <div ref={gridAreaRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {gridSize && (
        <div style={{
          position: 'relative',
          width: gridSize.w,
          height: gridSize.h,
          flexShrink: 0,
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
                const st = shapeTypeGrid?.[r][c];
                let bg = valid ? 'var(--code-bg)' : 'transparent';
                let bd = valid ? '1px solid var(--border)' : 'none';
                if (expertView && st) {
                  bg = HV_CELL_COLORS[st] || 'var(--code-bg)';
                  if (st !== 1) bd = `1px solid ${HV_CELL_BORDERS[st] || 'var(--border)'}`;
                }
                return (
                  <div
                    key={`${r}-${c}`}
                    style={{
                      borderRadius: 1,
                      background: bg,
                      border: bd,
                    }}
                  />
                );
              }),
            )}
          </div>
          {/* Idol cell overlays */}
          {!expertView && [...placed].filter((p) => isIdol(p.item)).flatMap((p) =>
            p.item.shape.flatMap((shapeRow, r) =>
              shapeRow.map((t, c) => {
                if (t !== 2 && t !== 3) return null;
                const gr = p.row + r;
                const gc = p.col + c;
                if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return null;
                return (
                  <div key={`idol-${p.instanceId}-${r}-${c}`} style={{
                    position: 'absolute',
                    left: `${(gc / cfg.cols) * 100}%`,
                    top: `${(gr / cfg.rows) * 100}%`,
                    width: `${(1 / cfg.cols) * 100}%`,
                    height: `${(1 / cfg.rows) * 100}%`,
                    background: 'rgba(255, 160, 0, 0.25)',
                    border: '1px solid rgba(255, 160, 0, 0.5)',
                    borderRadius: 1,
                    zIndex: 1,
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                  }} />
                );
              }),
            ),
          )}
          {/* Food box cell overlays */}
          {!expertView && [...placed].filter((p) => isFoodBox(p.item)).flatMap((p) =>
            p.item.shape.flatMap((shapeRow, r) =>
              shapeRow.map((t, c) => {
                if (t !== 2 && t !== 3) return null;
                const gr = p.row + r;
                const gc = p.col + c;
                if (gr < 0 || gr >= cfg.rows || gc < 0 || gc >= cfg.cols) return null;
                return (
                  <div key={`food-${p.instanceId}-${r}-${c}`} style={{
                    position: 'absolute',
                    left: `${(gc / cfg.cols) * 100}%`,
                    top: `${(gr / cfg.rows) * 100}%`,
                    width: `${(1 / cfg.cols) * 100}%`,
                    height: `${(1 / cfg.rows) * 100}%`,
                    background: 'rgba(33, 150, 243, 0.25)',
                    border: '1px solid rgba(33, 150, 243, 0.5)',
                    borderRadius: 1,
                    zIndex: 1,
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                  }} />
                );
              }),
            ),
          )}
          {/* Furniture images, same placement math as the full room grid — sorted by row (ascending) for z-index layering; col tiebreaker for determinism */}
          {[...placed].sort((a, b) => a.row - b.row || a.col - b.col).map((p) => {
            const { minR, maxR, minC, maxC } = getVisualBounds(p.item.shape);
            const visualRows = maxR - minR + 1;
            const visualCols = maxC - minC + 1;
            const anchorAlign = getImageAlignment(p.item.shape);
            const needsRotation = SVG_NEEDS_ROTATION.has(p.item.image_url);
            const src = p.item.image_url.startsWith('public/') ? p.item.image_url.slice(6) : p.item.image_url;
            const isHovered = hoverItemId === p.item.id;
            if (expertView) {
              return (
                <div
                  key={p.instanceId}
                  style={{
                    position: 'absolute',
                    left: `${((p.col + minC) / cfg.cols) * 100}%`,
                    top: `${((p.row + minR) / cfg.rows) * 100}%`,
                    width: `${(visualCols / cfg.cols) * 100}%`,
                    height: `${(visualRows / cfg.rows) * 100}%`,
                    zIndex: p.row,
                    borderRadius: 3,
                    border: '1px solid var(--border)',
                    background: 'rgba(0,0,0,0.06)',
                    pointerEvents: 'none',
                  }}
                  title={p.item.name}
                />
              );
            }
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
                  zIndex: p.row + (isHovered ? 100 : 0),
                  borderRadius: 3,
                }}
                title={p.item.name}
              >
                {needsRotation ? (
                  <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
                    <img
                      src={src}
                      alt={p.item.name}
                      draggable={false}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        transform: 'translate(-50%, -50%) rotate(90deg) scale(1.333)',
                      }}
                    />
                  </div>
                ) : (
                  <img
                    src={src}
                    alt={p.item.name}
                    draggable={false}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      objectPosition: anchorAlign === 'top' ? 'center top' : anchorAlign === 'bottom' ? 'center bottom' : 'center',
                    }}
                  />
                )}
                {isHovered && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    background: 'rgba(0,0,0,0.75)',
                    borderRadius: 4,
                    padding: '3px 6px',
                    pointerEvents: 'none',
                    zIndex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 1,
                  }}>
                    {p.item.appeal ? <span style={{ color: '#e06070', fontSize: 9, lineHeight: 1.2 }}>A:{p.item.appeal}</span> : null}
                    {p.item.comfort ? <span style={{ color: '#7ab8d4', fontSize: 9, lineHeight: 1.2 }}>C:{p.item.comfort}</span> : null}
                    {p.item.stimulation ? <span style={{ color: '#d4b87a', fontSize: 9, lineHeight: 1.2 }}>S:{p.item.stimulation}</span> : null}
                    {p.item.health ? <span style={{ color: '#7ad48a', fontSize: 9, lineHeight: 1.2 }}>H:{p.item.health}</span> : null}
                    {p.item.mutation ? <span style={{ color: '#c87ad4', fontSize: 9, lineHeight: 1.2 }}>M:{p.item.mutation}</span> : null}
                  </div>
                )}
              </div>
            );
          })}
          {/* Checklist number labels — only when checklist panel is open */}
          {labelNumbers && checklistOpen && [...placed].sort((a, b) => a.row - b.row || a.col - b.col).map((p) => {
            const n = labelNumbers[p.item.id];
            if (!n || hoverItemId === p.item.id) return null;
            const { minR, minC, maxC } = getVisualBounds(p.item.shape);
            const touchesCeiling = (p.row + minR) === 0;
            const touchesLeftWall = (p.col + minC) === 0;
            let labelLeft: string, labelTop: string;
            let labelTransform: string | undefined;
            if (touchesCeiling && touchesLeftWall) {
              labelLeft = `calc(${((p.col + maxC + 1) / cfg.cols) * 100}% + 1px)`;
              labelTop = `calc(${((p.row + minR) / cfg.rows) * 100}% + 1px)`;
            } else if (touchesCeiling) {
              labelLeft = `${((p.col + minC) / cfg.cols) * 100}%`;
              labelTop = `calc(${((p.row + minR) / cfg.rows) * 100}% + 1px)`;
              labelTransform = 'translateX(calc(-100% - 2px))';
            } else {
              labelLeft = `calc(${((p.col + minC) / cfg.cols) * 100}% + 1px)`;
              labelTop = `calc(${((p.row + minR) / cfg.rows) * 100}% + 1px)`;
            }
            return (
              <span key={`label-${p.instanceId}`} style={{
                position: 'absolute',
                left: labelLeft,
                top: labelTop,
                transform: labelTransform,
                zIndex: 500,
                background: 'rgba(0,0,0,0.7)',
                color: '#fff',
                borderRadius: 3,
                fontSize: 8,
                fontWeight: 700,
                padding: '0 3px',
                lineHeight: '11px',
                pointerEvents: 'none',
              }}>
                {n}
              </span>
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
        )}
      </div>
    </div>
  );
}

/**
 * Whole-house overview in the game's arrangement: attic on top,
 * Room 4 / Room 3 above Room 1 / Room 2 (matches the house image export).
 * Click a room to open it in the designer.
 */
export default function HouseView({ rooms, isRoomUnlocked, onSelectRoom, labelNumbers, hoverItemId, onHoverItem, onSelectItem, expertView, checklistOpen }: Props) {
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
      expertView={expertView}
      checklistOpen={checklistOpen}
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
