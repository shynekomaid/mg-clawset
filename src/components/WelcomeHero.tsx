import type { CSSProperties } from 'react';
import { CatSVG } from './CatMascot';

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  background: 'rgba(0,0,0,0.6)',
  backdropFilter: 'blur(4px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const card: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 20,
  padding: '36px 44px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  maxWidth: 440,
  textAlign: 'center',
};

const primaryBtn: CSSProperties = {
  padding: '12px 28px',
  borderRadius: 10,
  background: 'var(--accent)',
  color: 'var(--bg)',
  fontWeight: 700,
  fontSize: 15,
  border: '1px solid var(--accent)',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  width: '100%',
};

const secondaryBtn: CSSProperties = {
  padding: '10px 28px',
  borderRadius: 10,
  background: 'var(--social-bg)',
  color: 'var(--text-h)',
  fontWeight: 500,
  fontSize: 13,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'var(--font)',
  width: '100%',
};

interface Props {
  onLoadSavegame: () => void;
  onBrowse: () => void;
}

/** Minimal first-run screen: one decision, no text wall. Help lives behind the cat. */
export default function WelcomeHero({ onLoadSavegame, onBrowse }: Props) {
  return (
    <div style={overlay}>
      <div style={card}>
        <CatSVG size={110} />
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-h)' }}>
          Mewgenics Clawset
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-m)', lineHeight: 1.5 }}>
          Design your house rooms with the furniture you actually own — auto-filled for the stats you care about.
        </div>
        <button style={primaryBtn} onClick={onLoadSavegame}>
          📂 Load savegame
        </button>
        <button style={secondaryBtn} onClick={onBrowse}>
          Browse without a save
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-m)', lineHeight: 1.6 }}>
          Mewgenics Clawset — developed by{' '}
          <a href="https://github.com/baenar" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-m)' }}>
            baenar
          </a>{' '}
          (<a href="https://x.com/baenar_" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-m)' }}>@baenar_ on X</a>)
          {' '}and expanded by{' '}
          <a href="https://github.com/xxlbug/mg-clawset" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-m)' }}>
            xxlbug
          </a>
        </div>
      </div>
    </div>
  );
}
