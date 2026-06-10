import type { CSSProperties } from 'react';
import CatMascot from './CatMascot';

const bar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '6px 20px',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg)',
  flexShrink: 0,
};

const loadBtn: CSSProperties = {
  padding: '7px 18px',
  borderRadius: 8,
  background: 'var(--accent)',
  color: 'var(--bg)',
  fontWeight: 600,
  fontSize: 13,
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  whiteSpace: 'nowrap',
};

interface Props {
  onLoadSavegame: () => void;
  hasOwnership: boolean;
}

/** Persistent top bar: mascot (help), title, always-reachable savegame import. */
export default function AppHeader({ onLoadSavegame, hasOwnership }: Props) {
  return (
    <div style={bar}>
      {/* CatMascot renders the inline cat + click-to-open help overlay */}
      <div style={{ width: 56, flexShrink: 0, cursor: 'pointer' }} title="Help & info">
        <CatMascot compact onLoadSavegame={onLoadSavegame} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-h)', lineHeight: 1.2 }}>
          Mewgenics Clawset
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-m)' }}>
          room designer & furniture manager
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <button style={loadBtn} onClick={onLoadSavegame} title="Import owned furniture from your Mewgenics save file">
        📂 {hasOwnership ? 'Re-load savegame' : 'Load savegame'}
      </button>
    </div>
  );
}
