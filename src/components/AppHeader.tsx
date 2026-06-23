import type { CSSProperties } from 'react';
import { CatSVG } from './CatMascot';

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

export type AppView = 'house' | 'furniture' | 'breeding';

interface Props {
  /** Logo click: back to the house overview. */
  onHome: () => void;
  onLoadSavegame: () => void;
  hasOwnership: boolean;
  savefileName: string | null;
  reloading: boolean;
  /** Active main view; omit to hide the tabs (mobile). */
  view?: AppView;
  onViewChange?: (v: AppView) => void;
}

const tabBtn = (active: boolean): CSSProperties => ({
  padding: '7px 18px',
  borderRadius: 8,
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent-bg)' : 'transparent',
  color: active ? 'var(--accent)' : 'var(--text)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  whiteSpace: 'nowrap',
});

/** Persistent top bar: mascot (help), title, view tabs, always-reachable savegame import. */
export default function AppHeader({ onHome, onLoadSavegame, hasOwnership, savefileName, reloading, view, onViewChange }: Props) {
  return (
    <div style={bar}>
      <div style={{ width: 56, flexShrink: 0, cursor: 'pointer' }} title="Back to the house view" onClick={onHome}>
        <CatSVG size={44} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-h)', lineHeight: 1.2 }}>
          Mewgenics Clawset
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-m)' }}>
          room designer & furniture manager
        </span>
      </div>
      {view && onViewChange && (
        <div style={{ display: 'flex', gap: 4, marginLeft: 24 }}>
          <button style={tabBtn(view === 'house')} onClick={() => onViewChange('house')} title="Design rooms and auto-fill the house">
            House &amp; Rooms
          </button>
          <button style={tabBtn(view === 'furniture')} onClick={() => onViewChange('furniture')} title="Browse and edit your furniture collection">
            Furniture
          </button>
          <button style={tabBtn(view === 'breeding')} onClick={() => onViewChange('breeding')} title="Perfect 7 breeding guide with room recommendations">
            Breeding Guide
          </button>
        </div>
      )}
      <div style={{ flex: 1 }} />
      <button
        style={{ ...loadBtn, opacity: reloading ? 0.6 : 1 }}
        onClick={onLoadSavegame}
        disabled={reloading}
        title={savefileName ? `Re-reads ${savefileName} from disk` : 'Import owned furniture from your Mewgenics save file'}
      >
        {reloading ? 'Reloading…' : hasOwnership || savefileName ? 'Re-load savegame' : 'Load savegame'}
      </button>
    </div>
  );
}
