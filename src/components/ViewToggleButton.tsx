import type { CSSProperties } from 'react';

const styles: Record<string, CSSProperties> = {
  button: {
    position: 'absolute',
    right: -20,
    top: '50%',
    transform: 'translateY(-50%)',
    width: 20,
    height: 60,
    borderRadius: '0 8px 8px 0',
    border: '1px solid var(--border)',
    borderLeft: 'none',
    background: 'var(--code-bg)',
    color: 'var(--text)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    padding: 0,
    zIndex: 5,
    transition: 'background 0.2s',
  },
};

interface Props {
  expanded: boolean;
  onClick: () => void;
}

export default function ViewToggleButton({ expanded, onClick }: Props) {
  return (
    <button
      style={styles.button}
      onClick={onClick}
      title={expanded ? 'Hide furniture list' : 'Show furniture list'}
    >
      {expanded ? '▶' : '◀'}
    </button>
  );
}
