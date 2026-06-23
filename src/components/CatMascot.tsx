import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import StatIcon from './StatIcon';

function detectAdblock(): Promise<boolean> {
  return new Promise((resolve) => {
    const testUrl = 'https://gc.zgo.at/count.js';
    fetch(testUrl, { method: 'HEAD', mode: 'no-cors' })
      .then(() => {
        const scripts = document.querySelectorAll('script[data-goatcounter]');
        if (scripts.length === 0) { resolve(true); return; }
        setTimeout(() => {
          if (typeof (window as unknown as Record<string, unknown>).goatcounter === 'undefined') {
            resolve(true);
          } else {
            resolve(false);
          }
        }, 2000);
      })
      .catch(() => resolve(true));
  });
}

export const CatSVG = ({ size }: { size: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style={{ width: size, height: size, flexShrink: 0, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))', cursor: 'pointer' }}>
    <polygon points="15,20 85,20 75,0 25,0" fill="#C28F5A" />
    <polygon points="15,20 85,20 85,50 15,50" fill="#8C6239" />
    <polygon points="35,43 65,43 50,60" fill="#5D4037" />
    <polygon points="30,10 42,25 25,30" fill="#6D4C41" />
    <polygon points="70,10 58,25 75,30" fill="#6D4C41" />
    <polygon points="32,15 40,24 29,26" fill="#A1887F" />
    <polygon points="68,15 60,24 71,26" fill="#A1887F" />
    <polygon points="42,25 58,25 50,38" fill="#8D6E63" />
    <polygon points="46,25 50,32 54,25 50,29" fill="#3E2723" />
    <polygon points="25,80 42,75 50,43 20,40" fill="#6D4C41" />
    <polygon points="25,30 42,25 35,43 20,40" fill="#6D4C41" />
    <polygon points="75,80 58,75 50,43 80,40" fill="#6D4C41" />
    <polygon points="75,30 58,25 65,43 80,40" fill="#6D4C41" />
    <polygon points="42,25 50,38 35,43" fill="#8D6E63" />
    <polygon points="42,25 60,48 35,43" fill="#8D6E63" />
    <polygon points="58,25 50,38 65,43" fill="#8D6E63" />
    <polygon points="58,25 50,48 65,43" fill="#8D6E63" />
    <polygon points="22,38 35,41 25,43" fill="#3E2723" />
    <polygon points="78,38 65,41 75,43" fill="#3E2723" />
    <polygon points="47,38 53,38 50,41" fill="#6D4C41" />
    <polygon points="35,43 50,41 50,50 40,53" fill="#D7CCC8" />
    <polygon points="65,43 50,41 50,50 60,53" fill="#D7CCC8" />
    <polygon points="48,41 52,41 50,45" fill="#E08283" />
    <polygon points="33,34 43,34 38,39" fill="#6B8E23" />
    <polygon points="67,34 57,34 62,39" fill="#6B8E23" />
    <polygon points="37,34 39,34 38,39" fill="#1A1A1A" />
    <polygon points="63,34 61,34 62,39" fill="#1A1A1A" />
    <polygon points="15,50 15,20 3,10 3,40" fill="#E6B981" />
    <polygon points="85,50 85,20 97,10 97,40" fill="#E6B981" />
    <polygon points="15,50 85,50 85,85 15,85" fill="#D4A373" />
    <polygon points="15,50 85,50 75,73 25,73" fill="#C28F5A" />
    <polygon points="28,47 42,47 35,60" fill="#6D4C41" />
    <polygon points="31,51 39,51 35,56" fill="#3E2723" />
    <polygon points="72,47 58,47 65,60" fill="#6D4C41" />
    <polygon points="69,51 61,51 65,56" fill="#3E2723" />
  </svg>
);

const overlayBase: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.4s ease, backdrop-filter 0.4s ease',
};

const helpPanelBase: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: '28px 32px',
  maxWidth: 520,
  width: '90vw',
  maxHeight: '80vh',
  overflowY: 'auto',
  color: 'var(--text)',
  fontFamily: "'Rubik', system-ui, sans-serif",
  fontSize: 14,
  lineHeight: 1.6,
  boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  cursor: 'default',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  transition: 'opacity 0.4s ease, transform 0.4s ease',
};

const sectionStyle: CSSProperties = {
  width: '100%',
};

const headingStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text-h)',
  marginBottom: 6,
};

const statRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
  marginBottom: 4,
};

const statBadge = (color: string): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  background: color,
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-h)',
});

const bubbleStyle = (visible: boolean): CSSProperties => ({
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 6,
  padding: '10px 14px',
  borderRadius: '4px 12px 12px 12px',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: "'Rubik', system-ui, sans-serif",
  lineHeight: 1.45,
  width: 240,
  boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  zIndex: 50,
  cursor: 'pointer',
  opacity: visible ? 1 : 0,
  transform: visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.95)',
  transition: visible ? 'opacity 0.4s 0.5s, transform 0.4s 0.5s' : 'opacity 0.3s, transform 0.3s',
  pointerEvents: visible ? 'auto' : 'none',
});

const WELCOME_SEEN_KEY = 'mg-clawset-welcome-seen';

interface Props {
  compact?: boolean;
  isMobile?: boolean;
  onLoadSavegame?: () => void;
}

export default function CatMascot({ compact, isMobile, onLoadSavegame }: Props) {
  const [helpOpen, setHelpOpen] = useState(() => (isMobile ? !localStorage.getItem(WELCOME_SEEN_KEY) : false));
  const [helpVisible, setHelpVisible] = useState(false); // for animation
  const [helpDismissed, setHelpDismissed] = useState(false);
  const [adblockBubble, setAdblockBubble] = useState(false);
  const [adblockDetected, setAdblockDetected] = useState(false);

  useEffect(() => {
    detectAdblock().then((blocked) => {
      if (blocked) setAdblockDetected(true);
    });
  }, []);

  // Animate help panel in/out
  const [helpMounted, setHelpMounted] = useState(helpOpen); // DOM presence
  useEffect(() => {
    if (helpOpen) {
      setHelpMounted(true);
      // Trigger visible on next frame for CSS transition
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setHelpVisible(true));
      });
    } else {
      setHelpVisible(false);
      const id = setTimeout(() => setHelpMounted(false), 400); // match transition duration
      return () => clearTimeout(id);
    }
  }, [helpOpen]);

  // After help is dismissed for the first time, show adblock bubble if detected
  useEffect(() => {
    if (!helpDismissed || !adblockDetected) return;
    const id = setTimeout(() => setAdblockBubble(true), 600);
    return () => clearTimeout(id);
  }, [helpDismissed, adblockDetected]);

  const dismissHelp = useCallback(() => {
    setHelpOpen(false);
    setHelpDismissed(true);
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  }, []);

  const openHelp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!helpOpen) {
      setAdblockBubble(false);
      setHelpOpen(true);
    }
  }, [helpOpen]);

  // Dismiss adblock bubble on any click
  useEffect(() => {
    if (!adblockBubble) return;
    const handler = () => setAdblockBubble(false);
    const id = setTimeout(() => {
      window.addEventListener('click', handler, { once: true });
    }, 100);
    return () => {
      clearTimeout(id);
      window.removeEventListener('click', handler);
    };
  }, [adblockBubble]);

  return (
    <>
      {/* Inline cat in the filter header */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gridRow: '1 / 3',
          gridColumn: '1 / 3',
          marginLeft: compact ? -10 : 0,
        }}
        onClick={openHelp}
      >
        <CatSVG size={56} />

        {/* Adblock bubble — only after help dismissed */}
        {adblockDetected && helpDismissed && !helpOpen && (
          <div
            style={bubbleStyle(adblockBubble)}
            onClick={(e) => { e.stopPropagation(); setAdblockBubble(false); }}
          >
            Psst! Adblocker spotted — no ads here though! It just blocks our analytics. Mind whitelisting us?
            <div style={{ fontSize: 11, color: 'var(--text-m)', marginTop: 4 }}>
              click to dismiss
            </div>
          </div>
        )}
      </div>

      {/* Help overlay — portaled to body to avoid stacking context issues */}
      {helpMounted && createPortal(
        <div
          style={{
            ...overlayBase,
            background: helpVisible ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0)',
            backdropFilter: helpVisible ? 'blur(4px)' : 'blur(0px)',
          }}
          onClick={dismissHelp}
        >
          <div
            style={{
              ...helpPanelBase,
              opacity: helpVisible ? 1 : 0,
              transform: helpVisible ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <CatSVG size={100} />

            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-h)', textAlign: 'center' }}>
              Welcome to Mewgenics Clawset!
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-m)', textAlign: 'center' }}>
              Your furniture collection manager & room designer
            </div>

            <div style={sectionStyle}>
              <div style={headingStyle}>Stats</div>
              <div style={statRowStyle}>
                <span style={statBadge('rgba(193,73,83,0.7)')}><StatIcon stat="appeal" size={14} /> Appeal</span>
                <span style={statBadge('rgba(70,130,180,0.7)')}><StatIcon stat="comfort" size={14} /> Comfort</span>
                <span style={statBadge('rgba(180,140,60,0.7)')}><StatIcon stat="stimulation" size={14} /> Stimulation</span>
              </div>
              <div style={statRowStyle}>
                <span style={statBadge('rgba(80,160,80,0.7)')}><StatIcon stat="health" size={14} /> Health</span>
                <span style={statBadge('rgba(140,80,180,0.7)')}><StatIcon stat="mutation" size={14} /> Mutation</span>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={headingStyle}>Browsing & Filtering</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)' }}>
                <li>Use the <b>search bar</b> to filter furniture by name.</li>
                <li>Set <b>minimum stat values</b> in the filter row — only items meeting all thresholds are shown.</li>
                <li>Toggle <b>"Only"</b> to show only furniture you own.</li>
                <li>Click <b>column headers</b> (Name, stat icons...) to sort ascending/descending.</li>
                <li>Use <b>+</b> and <b>-</b> buttons to track how many of each item you have.</li>
              </ul>
            </div>

            <div style={sectionStyle}>
              <div style={headingStyle}>Room Designer</div>
              {isMobile ? (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--accent-bg)', color: 'var(--text)', fontSize: 13, lineHeight: 1.6 }}>
                  The Room Designer requires drag-and-drop and is available on <b>desktop/laptop</b> only. Visit this site on a PC to design your room!
                </div>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)' }}>
                  <li>Click the <b>arrow button</b> on the right edge to open the room planner.</li>
                  <li><b>Drag furniture images</b> from the list onto the grid to place them.</li>
                  <li>Furniture snaps to the grid based on its shape. Invalid placements are shown in red.</li>
                  <li><b>Drag placed furniture</b> to move it — connected pieces move together.</li>
                  <li><b>Click placed furniture</b> to remove it (anchored items are removed too).</li>
                  <li>Toggle <b>Expert View</b> to see cell types (solid, anchor point, anchor, background).</li>
                  <li>Stats summary at the top shows your room's total appeal, comfort, etc.</li>
                </ul>
              )}
            </div>

            <div style={sectionStyle}>
              <div style={headingStyle}>Import from Save File</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text)' }}>
                <li>Click <b>"Import from savefile"</b> at the bottom of the furniture list.</li>
                <li>Select your <code>.sav</code> file to automatically populate your owned furniture counts.</li>
              </ul>
            </div>

            <div style={{ ...sectionStyle, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={headingStyle}>Contact & Suggestions</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                Open to suggestions and feedback!
                <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                  <a
                    href="https://x.com/baenar_"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    @baenar_ on X
                  </a>
                  <a
                    href="https://github.com/baenar"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 500 }}
                  >
                    @baenar on GitHub
                  </a>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {!isMobile && onLoadSavegame && (
                <div
                  style={{
                    padding: '8px 24px',
                    borderRadius: 8,
                    background: 'var(--accent)',
                    color: 'var(--bg)',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    border: '1px solid var(--accent)',
                  }}
                  onClick={() => { dismissHelp(); onLoadSavegame(); }}
                >
                  Load savegame
                </div>
              )}
              <div
                style={{
                  padding: '8px 24px',
                  borderRadius: 8,
                  background: 'var(--accent-bg)',
                  color: 'var(--accent)',
                  fontWeight: 500,
                  fontSize: 13,
                  cursor: 'pointer',
                  border: '1px solid var(--border)',
                }}
                onClick={dismissHelp}
              >
                Got it, let me browse!
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-m)' }}>
              Shown once — click the cat anytime to reopen this help.
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
