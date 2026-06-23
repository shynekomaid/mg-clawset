import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PlacedFurniture } from '../types/furniture';
import StatIcon from './StatIcon';
import CatAvatar from './CatAvatar';
import {
  PERFECT7_STAGES,
  TOTAL_STEPS,
  nextStep,
  analyzeRoomsForBreeding,
  recommendBreedingRoom,
  recommendFightClubRoom,
  isDependableDen,
  stimGuarantees,
  STIM_BREAKPOINTS,
  COMFORT_FREE_OCCUPANCY,
  pairCoverage,
  betterStatChance,
  abilityInheritanceChances,
  CAT_STATS,
  CAT_STAT_LABELS,
  MAX_STAT,
} from '../utils/breeding';
import type { CatStat, RoomBreedingInfo, StatState } from '../utils/breeding';
import type { ParsedCat } from '../utils/catParser';
import {
  suggestFoundationPairs,
  summarizeRoster,
  sevensCount,
  bestSevens,
  deriveCompletedSteps,
} from '../utils/breedingRoster';
import type { PairSuggestion } from '../utils/breedingRoster';

// Illustrative foundation pair for the "cats you need" preview. Used only until
// a save is loaded — then everything below runs off your real roster.
const EXAMPLE_A: Record<CatStat, number> = { STR: 7, DEX: 7, CON: 5, INT: 7, SPD: 4, CHA: 7, LCK: 6 };
const EXAMPLE_B: Record<CatStat, number> = { STR: 6, DEX: 7, CON: 7, INT: 5, SPD: 7, CHA: 4, LCK: 7 };

const STATE_COLOR: Record<StatState, string> = {
  locked: 'rgb(80, 160, 80)',
  reachable: 'rgb(180, 140, 60)',
  missing: 'rgb(193, 73, 83)',
};
const STATE_LABEL: Record<StatState, string> = {
  locked: 'Locked 7 (both parents ≥7)',
  reachable: 'Reachable (one parent ≥7)',
  missing: 'Missing (needs an outcross)',
};

const card: CSSProperties = {
  background: 'var(--code-bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};
const h2: CSSProperties = { fontSize: 17, fontWeight: 700, color: 'var(--text-h)', margin: '0 0 4px' };
const sub: CSSProperties = { fontSize: 12, color: 'var(--text-m)', margin: '0 0 14px' };
const pill = (bg: string): CSSProperties => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11,
  fontWeight: 700, color: '#fff', background: bg,
});

/** "Floor1_Large" → "Floor1 Large" for display. */
function prettyRoom(cat: ParsedCat): string {
  if (cat.room) return cat.room.replace(/_/g, ' ');
  return cat.status;
}

interface Props {
  rooms: PlacedFurniture[][];
  isRoomUnlocked: (i: number) => boolean;
  /** Cats parsed from the loaded savegame (empty until one is imported). */
  cats: ParsedCat[];
  /** Jump to a room in the designer. */
  onOpenRoom: (i: number) => void;
  /** Trigger savegame import/reload. */
  onLoadSavegame?: () => void;
}

export default function BreedingGuide({ rooms, isRoomUnlocked, cats, onOpenRoom, onLoadSavegame }: Props) {
  const roomInfos = useMemo(
    () => analyzeRoomsForBreeding(rooms, isRoomUnlocked),
    [rooms, isRoomUnlocked],
  );
  const recommended = useMemo(() => recommendBreedingRoom(roomInfos), [roomInfos]);
  const fightClub = useMemo(() => recommendFightClubRoom(roomInfos), [roomInfos]);
  const stim = recommended?.stimulation ?? 0;
  const guarantees = stimGuarantees(stim);

  const hasCats = cats.length > 0;
  const roster = useMemo(() => (hasCats ? summarizeRoster(cats) : null), [cats, hasCats]);
  const suggestions = useMemo(
    () => (hasCats ? suggestFoundationPairs(cats, stim, { limit: 8 }) : []),
    [cats, hasCats, stim],
  );

  // Which pair the player is looking at. Cycles through the ranked suggestions
  // so they can pick a different match if the top one isn't preferred.
  const [pairIdx, setPairIdx] = useState(0);
  // idx is clamped on every render, so a shrinking/changing suggestion list can
  // never point out of bounds — no reset effect needed.
  const idx = suggestions.length ? Math.min(pairIdx, suggestions.length - 1) : 0;
  const selected: PairSuggestion | undefined = suggestions[idx];
  const cycle = (delta: number) => {
    if (!suggestions.length) return;
    setPairIdx((p) => (p + delta + suggestions.length) % suggestions.length);
  };

  // Progress is derived from the save, not ticked by hand. It tracks a
  // self-sustaining program — live pairs, maxed cats of both sexes, a dependable
  // den — not just whichever single cat happens to be strongest.
  const maxSevens = useMemo(() => bestSevens(cats), [cats]);
  const bestCat = roster?.topBreeders[0] ?? null;
  const viableRooms = useMemo(() => roomInfos.filter((r) => r.viable).length, [roomInfos]);
  const dependableDen = isDependableDen(recommended);
  const viablePairs = suggestions.length;
  const eliteMales = useMemo(
    () => cats.filter((c) => c.status === 'In House' && c.sex === 'male' && sevensCount(c) >= 6).length,
    [cats],
  );
  const eliteFemales = useMemo(
    () => cats.filter((c) => c.status === 'In House' && c.sex === 'female' && sevensCount(c) >= 6).length,
    [cats],
  );
  const done = useMemo(
    () => deriveCompletedSteps(cats, suggestions, { dependableDen, viableRooms }),
    [cats, suggestions, dependableDen, viableRooms],
  );
  const next = nextStep(done);
  const pctSteps = Math.round((done.size / TOTAL_STEPS) * 100);

  // "Cats you need" coverage grid: your selected pair, or the worked example.
  const previewA = selected ? selected.a.baseStats : EXAMPLE_A;
  const previewB = selected ? selected.b.baseStats : EXAMPLE_B;
  const previewCoverage = useMemo(() => pairCoverage(previewA, previewB, stim), [previewA, previewB, stim]);
  const abilities = abilityInheritanceChances(stim);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 520px', minWidth: 0 }}>
        {/* Intro */}
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-h)', margin: '0 0 4px' }}>
            Breeding Guide — Perfect 7
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-m)', margin: 0, lineHeight: 1.5 }}>
            Goal: a self-sustaining stable — maxed cats of both sexes and a dependable breeding
            den, not one lucky cat. Load your save and the guide tells you which two to breed next.
          </p>
        </div>

        {/* ── BREED NEXT — the one thing to do now ── */}
        <div style={{ ...card, borderColor: 'var(--accent)' }}>
          <h2 style={h2}>Breed next</h2>

          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <CatAvatar cat={selected.a} size={48} />
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-h)' }}>
                    {selected.a.name} <span style={{ color: 'var(--text-m)', fontWeight: 600, fontSize: 14 }}>({selected.a.sex})</span>
                  </span>
                </div>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-m)' }}>×</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <CatAvatar cat={selected.b} size={48} />
                  <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-h)' }}>
                    {selected.b.name} <span style={{ color: 'var(--text-m)', fontWeight: 600, fontSize: 14 }}>({selected.b.sex})</span>
                  </span>
                </div>
                {selected.mutualLover && <span title="Mutual lovers — breeds reliably" style={{ color: STATE_COLOR.locked, fontSize: 18 }}>♥</span>}
                {!selected.mutualLover && selected.lovesElsewhere && <span title="One loves another cat — less reliable" style={{ color: STATE_COLOR.reachable, fontSize: 16 }}>⚠</span>}
              </div>

              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
                <span>Expected <b style={{ color: 'var(--accent)', fontSize: 15 }}>{selected.coverage.coverage.toFixed(1)}/7</b> stats maxed per kitten</span>
                <span style={{ color: selected.riskPercent < 5 ? STATE_COLOR.locked : selected.riskPercent < 20 ? STATE_COLOR.reachable : STATE_COLOR.missing }}>
                  defect risk <b>{selected.riskPercent.toFixed(0)}%</b>
                </span>
                {selected.missing.length > 0 && (
                  <span style={{ color: STATE_COLOR.missing }}>still missing <b>{selected.missing.join(', ')}</b></span>
                )}
              </div>

              {/* where the two cats are right now */}
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, fontSize: 13, color: 'var(--text)' }}>
                <span><b>{selected.a.name}</b> is in <b>{prettyRoom(selected.a)}</b></span>
                <span><b>{selected.b.name}</b> is in <b>{prettyRoom(selected.b)}</b></span>
              </div>

              {/* class / role of each parent (heritable body genetics) */}
              {(selected.a.catClass || selected.b.catClass) && (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-m)' }}>
                  Class: <b style={{ color: 'var(--text)' }}>{selected.a.name}</b> {selected.a.catClass || 'classless'}
                  {' · '}<b style={{ color: 'var(--text)' }}>{selected.b.name}</b> {selected.b.catClass || 'classless'}
                  {selected.a.catClass && selected.a.catClass === selected.b.catClass && (
                    <span style={{ color: STATE_COLOR.locked }}> — both {selected.a.catClass}, breeds toward that role</span>
                  )}
                </div>
              )}

              {/* where to put them */}
              <div style={{ marginTop: 12, fontSize: 13 }}>
                {recommended ? (
                  <>
                    <span>
                      Move them together into{' '}
                      <button onClick={() => onOpenRoom(recommended.index)} style={linkBtn}>{recommended.label}</button>{' '}
                      — Stimulation <b>{recommended.stimulation}</b> ({Math.round(recommended.betterChance * 100)}% better-stat odds), Comfort <b>{recommended.comfort}</b>.
                    </span>
                    <div style={{ marginTop: 6, color: 'var(--text-m)', fontSize: 12 }}>
                      Keep this room at ≤{COMFORT_FREE_OCCUPANCY} cats — each extra cat (and each poop) costs 1 Comfort.{' '}
                      Guarantees at stim {recommended.stimulation}:{' '}
                      <GuaranteeTag on={guarantees.firstActive} label={`1st active (≥${STIM_BREAKPOINTS.firstActive})`} />{' '}
                      <GuaranteeTag on={guarantees.passive} label={`passive (≥${STIM_BREAKPOINTS.passive})`} />{' '}
                      <GuaranteeTag on={guarantees.secondActive} label={`2nd active (≥${STIM_BREAKPOINTS.secondActive})`} />
                    </div>
                  </>
                ) : (
                  <span style={{ color: STATE_COLOR.missing }}>
                    No viable breeding room yet — build one with Comfort ≥ -10 in the House view first.
                  </span>
                )}
              </div>

              {/* pair switcher */}
              {suggestions.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => cycle(-1)} style={ghostBtn} aria-label="Previous pair">◀</button>
                  <span style={{ fontSize: 12, color: 'var(--text-m)' }}>
                    Pair <b style={{ color: 'var(--text-h)' }}>{idx + 1}</b> of {suggestions.length} — ranked by coverage
                  </span>
                  <button onClick={() => cycle(1)} style={ghostBtn} aria-label="Next pair">▶</button>
                  <span style={{ fontSize: 12, color: 'var(--text-m)', marginLeft: 'auto' }}>not what you want? cycle for another match</span>
                </div>
              )}
            </>
          ) : hasCats ? (
            <p style={{ fontSize: 13, color: STATE_COLOR.missing, margin: '6px 0 0' }}>
              No viable unrelated in-house pair right now — bring in an unrelated stray, or check that your breeders are placed in the house.
            </p>
          ) : (
            <div style={{ fontSize: 13, marginTop: 6 }}>
              <p style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
                {next ? <>Method step: <b>{next.step.title}</b>. </> : null}
                Load your save to get the exact pair.
              </p>
              {onLoadSavegame
                ? <button onClick={onLoadSavegame} style={primaryBtn}>Load savegame →</button>
                : <span style={{ color: 'var(--text-m)' }}>Import a save from the furniture list.</span>}
            </div>
          )}
        </div>

        {/* ── PROGRESS — stable health, not just the best cat ── */}
        <div style={card}>
          <h2 style={h2}>Stable &amp; den progress</h2>
          <p style={sub}>
            {hasCats
              ? <><b>{done.size}/{TOTAL_STEPS}</b> method steps satisfied — auto-tracked from your save. Goal is a stable that keeps producing, not a single lucky cat.</>
              : <>Load a save to track progress automatically — no checkboxes to tick.</>}
          </p>
          <div style={{ height: 10, background: 'var(--bg)', borderRadius: 6, overflow: 'hidden', marginBottom: 14, border: '1px solid var(--border)' }}>
            <div style={{ width: `${pctSteps}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
            <Metric label="Closest cat" value={bestCat ? `${bestCat.name} · ${maxSevens}/${MAX_STAT}` : '—'} />
            <Metric label="Live unrelated pairs" value={hasCats ? String(viablePairs) : '—'} ok={viablePairs >= 2} warn={viablePairs < 1} />
            <Metric label="Maxed ♂ / ♀ (6+×7)" value={hasCats ? `${eliteMales} / ${eliteFemales}` : '—'} ok={eliteMales >= 1 && eliteFemales >= 1} warn={hasCats && eliteMales + eliteFemales === 0} />
            <Metric label="Dependable den" value={!hasCats && !roomInfos.length ? '—' : dependableDen ? 'yes' : viableRooms ? 'low stim' : 'none'} ok={dependableDen} warn={!dependableDen} />
            <Metric label="This pair's kittens" value={selected ? `${selected.coverage.coverage.toFixed(1)}/${MAX_STAT}` : `${previewCoverage.coverage.toFixed(1)}/${MAX_STAT} (ex.)`} accent />
          </div>
        </div>

        {/* ── DETAILS (collapsed) — full method, rooms, roster ── */}
        <details style={card}>
          <summary style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-h)', cursor: 'pointer' }}>
            Show full method, room guidance &amp; roster
          </summary>

          <div style={{ marginTop: 18 }}>
            {/* room guidance */}
            <h3 style={h3}>Room guidance</h3>
            <p style={sub}>
              Breeding rooms want high <b>Stimulation</b> (better-stat odds) and Comfort ≥ -10 (below that
              breeding auto-fails). Totals come from the furniture you placed in the House view.
            </p>
            {roomInfos.length === 0 ? (
              <p style={{ fontSize: 13, color: STATE_COLOR.missing }}>No unlocked rooms. Load a savegame or design rooms in the House view.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-m)', fontSize: 11 }}>
                      <th style={th}>Room</th>
                      <th style={th}><StatIcon stat="stimulation" size={14} /> Stim</th>
                      <th style={th}><StatIcon stat="comfort" size={14} /> Comfort</th>
                      <th style={th}>Better-stat odds</th>
                      <th style={th}>Status</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {roomInfos.map((r) => <RoomRow key={r.index} r={r} best={r.index === recommended?.index} onOpen={() => onOpenRoom(r.index)} />)}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-m)', margin: '10px 0 0' }}>
              At Stimulation {stim}: better-stat inheritance {Math.round(betterStatChance(stim) * 100)}%,
              first-ability {Math.round(abilities.firstActive * 100)}%, passive {Math.round(abilities.passive * 100)}%.
              Stimulation guarantees kick in at {STIM_BREAKPOINTS.firstActive} (1st active),
              {' '}{STIM_BREAKPOINTS.passive} (passive), {STIM_BREAKPOINTS.secondActive} (2nd active).
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-m)', margin: '8px 0 0' }}>
              <b>Den occupancy:</b> keep each breeding room at ≤{COMFORT_FREE_OCCUPANCY} cats (two pairs).
              Every cat past the {COMFORT_FREE_OCCUPANCY}th — and every poop — drops Comfort by 1, which slows breeding.
            </p>
            {fightClub && (
              <p style={{ fontSize: 12, color: 'var(--text-m)', margin: '8px 0 0' }}>
                <b>Training room (optional):</b> the opposite of a den — a deliberately low-Comfort room makes cats
                spar and gain combat stats (level/item stats, not the base 7). Your lowest-Comfort room is{' '}
                <button onClick={() => onOpenRoom(fightClub.index)} style={linkBtn}>{fightClub.label}</button>{' '}
                (Comfort {fightClub.comfort}). Park mediocre cats there to grow champions for adventures.
              </p>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-m)', margin: '8px 0 0' }}>
              <b>Body genetics:</b> a cat's <b>class</b> and head/body shapes are heritable too — pick parents
              of the role you want (e.g. Mage for INT, Tank for defense). The guide now reads each cat's class
              and shape from your save: classes show on the breed-next pair and in Top breeders above.
            </p>

            {/* cats you need — coverage grid for the selected pair */}
            <h3 style={{ ...h3, marginTop: 24 }}>Stat coverage {selected ? `— ${selected.a.name} × ${selected.b.name}` : '(example)'}</h3>
            <p style={sub}>
              Between both parents a stat is
              <span style={{ color: STATE_COLOR.locked, fontWeight: 700 }}> locked</span> (both ≥7),
              <span style={{ color: STATE_COLOR.reachable, fontWeight: 700 }}> reachable</span> (one ≥7), or
              <span style={{ color: STATE_COLOR.missing, fontWeight: 700 }}> missing</span> (neither). Odds at Stimulation {stim}.
            </p>
            <CoverageGrid a={previewA} b={previewB} cov={previewCoverage} />
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
              {(['locked', 'reachable', 'missing'] as StatState[]).map((s) => (
                <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-m)' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: STATE_COLOR[s], display: 'inline-block' }} />
                  {STATE_LABEL[s]}
                </span>
              ))}
            </div>

            {/* ranked pairs + roster */}
            {hasCats && roster && (
              <>
                <h3 style={{ ...h3, marginTop: 24 }}>All suggested pairs</h3>
                <p style={sub}>
                  {roster.total} cats · {roster.inHouse} in house · {roster.males}♂ / {roster.females}♀.
                  Highest-coverage in-house matches, defect risk ≤ 10%. Family and mutual haters excluded;
                  mutual lovers (<span style={{ color: STATE_COLOR.locked }}>♥</span>) preferred, loves-elsewhere (<span style={{ color: STATE_COLOR.reachable }}>⚠</span>) demoted.
                  Click a row to make it the "breed next" pair.
                </p>
                {suggestions.length === 0 ? (
                  <p style={{ fontSize: 13, color: STATE_COLOR.missing }}>No viable unrelated in-house pairs found.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-m)', fontSize: 11 }}>
                          <th style={th}>Pair</th>
                          <th style={th}>Expected 7s</th>
                          <th style={th}>Risk%</th>
                          <th style={th}>Locked now</th>
                          <th style={th}>Missing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.map((s, i) => (
                          <SuggestionRow key={`${s.a.dbKey}-${s.b.dbKey}`} s={s} active={i === idx} onPick={() => setPairIdx(i)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 style={{ ...h3, marginTop: 24 }}>Top breeders (most 7s already)</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {roster.topBreeders.map((c) => (
                    <span key={c.dbKey} title={CAT_STATS.map((st) => `${st} ${c.baseStats[st]}`).join(' · ')}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, background: 'var(--social-bg)', border: '1px solid var(--border)' }}>
                      <b>{c.name}</b> <span style={{ color: 'var(--text-m)' }}>{c.sex} · {sevensCount(c)}×7{c.catClass ? ` · ${c.catClass}` : ''} · {prettyRoom(c)}</span>
                    </span>
                  ))}
                </div>
              </>
            )}

            {/* staged plan — auto-tracked, read-only */}
            <h3 style={{ ...h3, marginTop: 24 }}>The {PERFECT7_STAGES.length}-stage method ({TOTAL_STEPS} steps)</h3>
            <p style={sub}>Auto-tracked from your save — the highlighted step is what "Breed next" is driving toward.</p>
            {PERFECT7_STAGES.map((stage) => (
              <div key={stage.num} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={pill('var(--accent)')}>Stage {stage.num}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-h)' }}>{stage.title}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-m)' }}>— {stage.goal}</span>
                </div>
                {stage.steps.map((step) => {
                  const checked = done.has(step.id);
                  const isNext = next?.step.id === step.id;
                  return (
                    <div key={step.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, background: isNext ? 'var(--accent-bg)' : checked ? 'var(--social-bg)' : 'transparent', border: isNext ? '1px solid var(--accent)' : '1px solid transparent', marginBottom: 4 }}>
                      <span style={{ marginTop: 1, fontSize: 14 }}>{checked ? '✓' : isNext ? '▸' : '○'}</span>
                      <span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-h)', textDecoration: checked ? 'line-through' : 'none', opacity: checked ? 0.6 : 1 }}>{step.title}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--text-m)', marginTop: 2, lineHeight: 1.45 }}>{step.detail}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </details>

        <p style={{ fontSize: 11, color: 'var(--text-m)', textAlign: 'center', marginBottom: 24 }}>
          Method + cat-save parsing adapted from frankieg33/MewgenicsBreedingManager (Perfect 7 Planner).
          {hasCats ? ' Roster read from your loaded savegame.' : ' Load a savegame to analyze your real cats.'}
        </p>
        </div>

        {/* ── CHECKLIST PANEL (sticky right) ── */}
        <aside style={{ flex: '0 1 260px', minWidth: 220, position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <div style={{ ...card, marginBottom: 0 }}>
            <h2 style={{ ...h2, marginBottom: 2 }}>Checklist</h2>
            <p style={{ ...sub, marginBottom: 12 }}>{done.size}/{TOTAL_STEPS} done{hasCats ? '' : ' · load a save'}</p>
            {PERFECT7_STAGES.map((stage) => (
              <div key={stage.num} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-m)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  Stage {stage.num} · {stage.title}
                </div>
                {stage.steps.map((step) => {
                  const checked = done.has(step.id);
                  const isNext = next?.step.id === step.id;
                  return (
                    <div key={step.id} title={step.title}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, lineHeight: 1.5,
                        padding: '3px 6px', borderRadius: 6, marginBottom: 1,
                        background: isNext ? 'var(--accent-bg)' : 'transparent',
                        fontWeight: isNext ? 700 : 500,
                        color: isNext ? 'var(--accent)' : checked ? 'var(--text-m)' : 'var(--text)' }}>
                      <span style={{ fontSize: 12 }}>{checked ? '✓' : isNext ? '▸' : '○'}</span>
                      <span style={{ textDecoration: checked ? 'line-through' : 'none' }}>{step.short}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Inline ✓/✗ chip for a stimulation guarantee. */
function GuaranteeTag({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{ color: on ? STATE_COLOR.locked : STATE_COLOR.missing, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {on ? '✓' : '✗'} {label}
    </span>
  );
}

/** One labelled stat in the stable-health row. `ok` tints it green, `warn` red. */
function Metric({ label, value, ok, warn, accent }: { label: string; value: string; ok?: boolean; warn?: boolean; accent?: boolean }) {
  const color = accent ? 'var(--accent)' : ok ? STATE_COLOR.locked : warn ? STATE_COLOR.missing : 'var(--text-h)';
  return (
    <div>
      <div style={{ color: 'var(--text-m)', fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function RoomRow({ r, best, onOpen }: { r: RoomBreedingInfo; best: boolean; onOpen: () => void }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)', background: best ? 'var(--accent-bg)' : 'transparent' }}>
      <td style={td}>
        <b style={{ color: best ? 'var(--accent)' : 'var(--text-h)' }}>{r.label}</b>
        {best && <span style={{ ...pill('var(--accent)'), marginLeft: 8 }}>BEST</span>}
        {r.itemCount === 0 && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-m)' }}>(empty)</span>}
      </td>
      <td style={td}>{r.stimulation}</td>
      <td style={{ ...td, color: r.comfort < 0 ? STATE_COLOR.missing : 'var(--text)' }}>{r.comfort}</td>
      <td style={td}>{Math.round(r.betterChance * 100)}%</td>
      <td style={td}>
        {r.viable
          ? <span style={{ color: STATE_COLOR.locked }}>✓ viable</span>
          : <span style={{ color: STATE_COLOR.missing }}>✗ auto-fail (Comfort &lt; -10)</span>}
      </td>
      <td style={td}><button onClick={onOpen} style={linkBtn}>Open →</button></td>
    </tr>
  );
}

function SuggestionRow({ s, active, onPick }: { s: PairSuggestion; active: boolean; onPick: () => void }) {
  return (
    <tr onClick={onPick} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer', background: active ? 'var(--accent-bg)' : 'transparent' }}>
      <td style={td}>
        <b style={{ color: 'var(--text-h)' }}>{s.a.name}</b> <span style={{ color: 'var(--text-m)' }}>({s.a.sex})</span>
        {' × '}
        <b style={{ color: 'var(--text-h)' }}>{s.b.name}</b> <span style={{ color: 'var(--text-m)' }}>({s.b.sex})</span>
        {s.mutualLover && <span title="Mutual lovers — breeds reliably" style={{ color: STATE_COLOR.locked, marginLeft: 6 }}>♥</span>}
        {!s.mutualLover && s.lovesElsewhere && <span title="One of them is in love with another cat — breeds less reliably" style={{ color: STATE_COLOR.reachable, marginLeft: 6 }}>⚠</span>}
      </td>
      <td style={td}><b style={{ color: 'var(--accent)' }}>{s.coverage.coverage.toFixed(1)}/7</b></td>
      <td style={{ ...td, color: s.riskPercent < 5 ? STATE_COLOR.locked : s.riskPercent < 20 ? STATE_COLOR.reachable : STATE_COLOR.missing }}>{s.riskPercent.toFixed(0)}%</td>
      <td style={{ ...td, color: STATE_COLOR.locked }}>{s.coverage.locked.length ? s.coverage.locked.join(', ') : '—'}</td>
      <td style={{ ...td, color: s.missing.length ? STATE_COLOR.missing : 'var(--text-m)' }}>{s.missing.length ? s.missing.join(', ') : 'none ✓'}</td>
    </tr>
  );
}

function CoverageGrid({ a, b, cov }: { a: Record<CatStat, number>; b: Record<CatStat, number>; cov: ReturnType<typeof pairCoverage> }) {
  const cell: CSSProperties = { padding: '4px 8px', textAlign: 'center', fontWeight: 700, fontSize: 13 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...cell, textAlign: 'left', color: 'var(--text-m)' }} />
            {CAT_STATS.map((s) => (
              <th key={s} style={{ ...cell, color: 'var(--text-m)' }} title={CAT_STAT_LABELS[s]}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[['Parent A', a], ['Parent B', b]].map(([label, stats]) => (
            <tr key={label as string}>
              <td style={{ ...cell, textAlign: 'left', color: 'var(--text)' }}>{label as string}</td>
              {CAT_STATS.map((s) => {
                const v = (stats as Record<CatStat, number>)[s];
                return (
                  <td key={s} style={{ ...cell, color: v >= MAX_STAT ? STATE_COLOR.locked : 'var(--text-m)' }}>{v}</td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid var(--border)' }}>
            <td style={{ ...cell, textAlign: 'left', color: 'var(--text)' }}>Kitten 7?</td>
            {CAT_STATS.map((s) => (
              <td key={s} style={cell}>
                <span style={{ display: 'inline-block', width: 22, height: 22, lineHeight: '22px', borderRadius: 5, color: '#fff', background: STATE_COLOR[cov.states[s]] }}>
                  {cov.states[s] === 'locked' ? '7' : cov.states[s] === 'reachable' ? '~' : '✗'}
                </span>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const th: CSSProperties = { padding: '6px 10px', fontWeight: 600 };
const td: CSSProperties = { padding: '8px 10px' };
const h3: CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--text-h)', margin: '0 0 4px' };
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13, fontFamily: 'var(--font)' };
const primaryBtn: CSSProperties = { padding: '7px 16px', borderRadius: 8, background: 'var(--accent)', color: 'var(--bg)', fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer', fontFamily: 'var(--font)' };
const ghostBtn: CSSProperties = { padding: '4px 12px', borderRadius: 8, background: 'var(--bg)', color: 'var(--text-h)', fontWeight: 700, fontSize: 13, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font)' };
