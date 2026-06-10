import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';
import { parseSavegame } from '../utils/savegame';
import { isFilePickerSupported } from '../utils/savefileHandle';

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modal: CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  padding: '28px 32px',
  maxWidth: 520,
  width: '90%',
  fontFamily: 'var(--font)',
  color: 'var(--text-h)',
  position: 'relative',
};

const heading: CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 16,
  color: 'var(--text-h)',
};

const paragraph: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: 'var(--text)',
  marginBottom: 12,
};

const pathBox: CSSProperties = {
  background: 'var(--code-bg)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'monospace',
  color: 'var(--text-h)',
  marginBottom: 16,
  wordBreak: 'break-all',
  border: '1px solid var(--border)',
};

const warningBox: CSSProperties = {
  background: 'rgba(193,73,83,0.12)',
  border: '1px solid rgba(193,73,83,0.3)',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  color: 'var(--blushed-brick)',
  marginBottom: 16,
};

const buttonRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
  marginTop: 20,
};

const btnBase: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

const fileLabel: CSSProperties = {
  display: 'inline-block',
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px dashed var(--border)',
  background: 'var(--code-bg)',
  color: 'var(--text-h)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'center',
  width: '100%',
  boxSizing: 'border-box',
};

const statusText: CSSProperties = {
  fontSize: 12,
  marginTop: 8,
  minHeight: 18,
};

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (ownership: Record<string, number>) => void;
  furnitureIdMap: Map<string, string>; // lowercase name -> id
  /** Called when the file was picked via the File System Access API (Chromium) so the handle can be remembered. */
  onHandleCaptured?: (handle: FileSystemFileHandle) => void;
}

export default function SaveImportModal({ open, onClose, onImport, furnitureIdMap, onHandleCaptured }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setStatus('Reading save file...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      setStatus('Parsing furniture data...');
      const { ownership: newOwnership, matched, unmatchedNames } = await parseSavegame(uint8Array, furnitureIdMap);

      console.log('[SaveImport] Matched:', matched, 'Unmatched:', unmatchedNames);

      setStatus(`Found ${matched} furniture types (${unmatchedNames.length} unmatched). Importing...`);
      onImport(newOwnership);

      setTimeout(() => {
        setStatus('');
        setFile(null);
        onClose();
      }, 800);
    } catch (err) {
      setError(`Error parsing save file: ${err instanceof Error ? err.message : String(err)}`);
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={heading}>Import Inventory from Save File</h2>

        <p style={paragraph}>
          Upload your Mewgenics save file to automatically populate your furniture inventory.
          The save file can be found at:
        </p>

        <div style={pathBox}>
          C:\Users\&lt;username&gt;\AppData\Roaming\Glaiel Games\Mewgenics\&lt;steam_id&gt;\saves\
        </div>

        <p style={paragraph}>
          Look for files with the <strong>.sav</strong> extension in the saves folder.
        </p>

        <div style={warningBox}>
          ⚠ This will overwrite your current inventory data. Any manually added counts will be replaced.
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".sav,.db,.sqlite"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setError('');
            setStatus('');
          }}
        />

        <label
          style={fileLabel}
          onClick={async () => {
            if (isFilePickerSupported()) {
              try {
                const [handle] = await window.showOpenFilePicker!({
                  types: [{ description: 'Mewgenics save', accept: { 'application/octet-stream': ['.sav', '.db', '.sqlite'] } }],
                });
                setFile(await handle.getFile());
                setError('');
                setStatus('');
                onHandleCaptured?.(handle);
                return;
              } catch {
                return; // user cancelled the picker
              }
            }
            fileRef.current?.click();
          }}
        >
          {file ? `📁 ${file.name}` : 'Click to select .sav file'}
        </label>

        {status && <div style={{ ...statusText, color: 'var(--text)' }}>{status}</div>}
        {error && <div style={{ ...statusText, color: 'var(--blushed-brick)' }}>{error}</div>}

        <div style={buttonRow}>
          <button
            style={{ ...btnBase, background: 'var(--code-bg)', color: 'var(--text)' }}
            onClick={() => {
              setFile(null);
              setStatus('');
              setError('');
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            style={{
              ...btnBase,
              background: file && !loading ? 'var(--blushed-brick)' : 'var(--code-bg)',
              color: file && !loading ? '#fff' : 'var(--text)',
              opacity: file && !loading ? 1 : 0.5,
              cursor: file && !loading ? 'pointer' : 'not-allowed',
            }}
            disabled={!file || loading}
            onClick={handleImport}
          >
            {loading ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
