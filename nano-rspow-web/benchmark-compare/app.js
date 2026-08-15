import React, { useEffect, useMemo, useRef, useState } from 'https://esm.sh/react@19.1.0';
import { createRoot } from 'https://esm.sh/react-dom@19.1.0/client';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'https://esm.sh/recharts@2.15.1?deps=react@19.1.0,react-dom@19.1.0';
import initNanoRspow, { generate_work as generateNanoRspow } from './nano_rspow_web.js';
// Keep the competitor fixture local so this page remains reproducible and does
// not change when the npm "latest" tag moves.
import { NanoPow } from './nano-pow-bundle.js';

const html = htm.bind(React.createElement);

const EPOCH2_SEND_THRESHOLD = 'fffffff800000000';
const NANOPOW_OPTIONS = { difficulty: EPOCH2_SEND_THRESHOLD };
const BATTLE_TURNS = 42;
const BATTLE_COOLDOWN_MS = 100;
const COLORS = {
  rspow: '#2563eb',
  nanopow: '#16a34a',
};

function randomRoot() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function battleRootFromNonce(nonce) {
  // A Nano work value is eight bytes while a work root is 32 bytes. Repeat the
  // exact result four times so the next solver's root is derived directly from
  // the preceding solver's output without introducing another hash function.
  return nonce.repeat(4);
}

function sleep(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatDuration(milliseconds) {
  if (milliseconds < 1000) return `${milliseconds.toFixed(0)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function quantile(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function distributionStats(data) {
  const values = data.map((sample) => sample.elapsedMs);
  return {
    count: values.length,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    p25: quantile(values, 0.25),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
  };
}

function ScatterTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;

  const sample = payload[0].payload;
  return html`
    <div className="chart-tooltip">
      <strong>${sample.label}</strong>
      <span>${formatDuration(sample.elapsedMs)}</span>
      <small>${sample.mode === 'battle' ? `battle turn ${sample.turn}` : `round ${sample.round}`} · root ${sample.root.slice(0, 12)}…</small>
    </div>
  `;
}

function BenchmarkApp() {
  const [ready, setReady] = useState(false);
  const [initializationError, setInitializationError] = useState('');
  const [active, setActive] = useState(null);
  const [round, setRound] = useState(1);
  const [root, setRoot] = useState(randomRoot);
  const [completedInRound, setCompletedInRound] = useState(new Set());
  const [samples, setSamples] = useState([]);
  const [message, setMessage] = useState('Loading nano-rspow WebAssembly…');
  const [battle, setBattle] = useState({ running: false, stopRequested: false, completed: 0, current: null });
  const [battleRootState, setBattleRootState] = useState(null);
  const battleStopRef = useRef(false);

  useEffect(() => {
    initNanoRspow()
      .then(() => {
        setReady(true);
        setMessage('Ready. Run both solvers against round 1’s work root.');
      })
      .catch((error) => {
        setInitializationError(error instanceof Error ? error.message : String(error));
        setMessage('nano-rspow could not initialize.');
      });
  }, []);

  const series = useMemo(() => ({
    rspow: samples
      .filter((sample) => sample.implementation === 'rspow')
      .map((sample, index) => ({ ...sample, providerX: 1 + (((index * 37) % 11) - 5) / 100 })),
    nanopow: samples
      .filter((sample) => sample.implementation === 'nanopow')
      .map((sample, index) => ({ ...sample, providerX: 2 + (((index * 53) % 11) - 5) / 100 })),
  }), [samples]);

  const stats = useMemo(() => ({
    rspow: distributionStats(series.rspow),
    nanopow: distributionStats(series.nanopow),
  }), [series]);

  const finishRoundIfComplete = (implementation) => {
    setCompletedInRound((previous) => {
      const next = new Set(previous);
      next.add(implementation);
      if (next.size === 2) {
        setRound((value) => value + 1);
        setRoot(randomRoot());
        setMessage(`Round ${round} complete. A new shared work root is ready.`);
        return new Set();
      }
      setMessage(`Recorded ${implementation === 'rspow' ? 'nano-rspow' : 'NanoPow'}. Run the other solver with this same root.`);
      return next;
    });
  };

  const solve = async (implementation, workRoot) => {
    const startedAt = performance.now();
    let nonce;
    let backend;

    if (implementation === 'rspow') {
      const result = await generateNanoRspow(workRoot, EPOCH2_SEND_THRESHOLD);
      nonce = result.nonce;
      backend = result.is_gpu ? 'WebGPU' : 'CPU WASM fallback';
    } else {
      const result = await NanoPow.work_generate(workRoot, NANOPOW_OPTIONS);
      nonce = result.work;
      backend = result.api ?? 'automatic API selection';
    }

    return {
      elapsedMs: performance.now() - startedAt,
      nonce,
      backend,
    };
  };

  const runBenchmark = async (implementation) => {
    if (!ready || active || completedInRound.has(implementation)) return;

    setActive(implementation);
    setMessage(`Running ${implementation === 'rspow' ? 'nano-rspow' : 'NanoPow'} at the Epoch 2 send threshold…`);
    try {
      const { elapsedMs, nonce, backend } = await solve(implementation, root);
      const label = implementation === 'rspow' ? 'nano-rspow' : 'NanoPow';
      setSamples((previous) => [...previous, {
        id: `round-${round}-${implementation}`,
        implementation,
        label,
        round,
        elapsedMs,
        root,
        nonce,
        backend,
      }]);
      finishRoundIfComplete(implementation);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`${implementation === 'rspow' ? 'nano-rspow' : 'NanoPow'} failed: ${detail}`);
    } finally {
      setActive(null);
    }
  };

  const runBattle = async () => {
    if (!ready || active || battle.running) return;

    battleStopRef.current = false;
    setActive('battle');
    setBattle({ running: true, stopRequested: false, completed: 0, current: 'rspow' });

    let battleRoot = root;
    setBattleRootState(battleRoot);
    let completed = 0;
    try {
      for (let turn = 1; turn <= BATTLE_TURNS; turn += 1) {
        if (battleStopRef.current) break;

        const implementation = turn % 2 === 1 ? 'rspow' : 'nanopow';
        const label = implementation === 'rspow' ? 'nano-rspow' : 'NanoPow';
        setBattle((previous) => ({ ...previous, current: implementation, completed }));
        setMessage(`Battle turn ${turn}/${BATTLE_TURNS}: running ${label}…`);

        const { elapsedMs, nonce, backend } = await solve(implementation, battleRoot);
        setSamples((previous) => [...previous, {
          id: `battle-${turn}-${implementation}`,
          implementation,
          label,
          mode: 'battle',
          turn,
          elapsedMs,
          root: battleRoot,
          nonce,
          backend,
        }]);

        completed = turn;
        battleRoot = battleRootFromNonce(nonce);
        setBattleRootState(battleRoot);
        setBattle((previous) => ({ ...previous, completed }));

        if (turn < BATTLE_TURNS && !battleStopRef.current) {
          setMessage(`Battle turn ${turn}/${BATTLE_TURNS} recorded. Cooling down for ${BATTLE_COOLDOWN_MS} ms…`);
          await sleep(BATTLE_COOLDOWN_MS);
        }
      }

      setMessage(battleStopRef.current
        ? `Battle stopped after ${completed} of ${BATTLE_TURNS} turns.`
        : `Battle complete: ${BATTLE_TURNS} alternating turns recorded.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`Battle stopped after ${completed} turns: ${detail}`);
    } finally {
      battleStopRef.current = false;
      setBattle((previous) => ({ ...previous, running: false, stopRequested: false, current: null, completed }));
      setBattleRootState(null);
      setActive(null);
    }
  };

  const stopBattle = () => {
    battleStopRef.current = true;
    setBattle((previous) => ({ ...previous, stopRequested: true }));
    const activeLabel = battle.current === 'nanopow' ? 'NanoPow' : 'nano-rspow';
    setMessage(`Stopping… ${activeLabel} is allowed to finish its current work search before the battle ends.`);
  };

  const buttonState = (implementation) => {
    if (active) return active === 'battle' ? 'Battle in progress' : 'Running…';
    if (completedInRound.has(implementation)) return 'Recorded for this round';
    return implementation === 'rspow' ? 'Run nano-rspow' : 'Run NanoPow';
  };

  const isDisabled = (implementation) => !ready || Boolean(active) || completedInRound.has(implementation);
  const runningImplementation = active === 'battle' ? battle.current : active;
  const statusAlignment = runningImplementation === 'nanopow' ? 'status-align-right' : 'status-align-left';
  const displayedRoot = battle.running && battleRootState ? battleRootState : root;

  return html`
    <section className="page-shell">
      <header className="hero">
        <p className="eyebrow">Browser benchmark · Epoch 2 send</p>
        <h1>One work root. Two local PoW engines.</h1>
        <p className="lede">
          Each round uses the same random root and records elapsed wall-clock time.
          Runs are intentionally serialized: GPU and CPU pressure should belong to one solver at a time.
        </p>
      </header>

      <section className="control-card" aria-label="Benchmark controls">
        <div className="round-meta">
          <span className="round-label">${battle.running ? `Battle turn ${Math.min(battle.completed + 1, BATTLE_TURNS)}/${BATTLE_TURNS}` : `Round ${round}`}</span>
          <code title=${displayedRoot}>${displayedRoot}</code>
          <span className="threshold">threshold ${EPOCH2_SEND_THRESHOLD}</span>
        </div>
        <div className="button-row">
          <button
            className="benchmark-button button-rspow"
            disabled=${isDisabled('rspow')}
            onClick=${() => runBenchmark('rspow')}
          >
            <span className="button-dot"></span>${buttonState('rspow')}
          </button>
          <button
            className="benchmark-button button-nanopow"
            disabled=${isDisabled('nanopow')}
            onClick=${() => runBenchmark('nanopow')}
          >
            <span className="button-dot"></span>${buttonState('nanopow')}
          </button>
        </div>
        <button
          className=${`battle-button ${battle.running ? 'is-running' : ''} ${battle.stopRequested ? 'is-stopping' : ''}`}
          disabled=${!ready || Boolean(active && !battle.running) || battle.stopRequested}
          onClick=${battle.running ? stopBattle : runBattle}
        >
          <span className="button-label">
            ${battle.running
              ? battle.stopRequested ? 'Stopping…' : 'Stop!'
              : 'Start ping-pong battle'}
          </span>
        </button>
        <p className="battle-note">
          ${BATTLE_TURNS} alternating turns (${BATTLE_COOLDOWN_MS} ms between turns), beginning with nano-rspow.
          Each result becomes the next work root.
        </p>
        <p className=${`${initializationError ? 'status status-error' : 'status'} ${statusAlignment}`} aria-live="polite">
          ${message}
        </p>
      </section>

      <section className="chart-card" aria-label="Benchmark result scatter chart">
        <div className="chart-heading">
          <div>
            <p className="eyebrow">Results</p>
            <h2>Run-time distribution</h2>
            <p className="chart-note">Each dot is one run. The shaded band is p25–p75; the line is the median.</p>
          </div>
          <div className="legend" aria-label="Chart legend">
            <span><i className="legend-dot legend-rspow"></i>nano-rspow</span>
            <span><i className="legend-dot legend-nanopow"></i>NanoPow</span>
          </div>
        </div>
        <div className="chart-frame">
          ${samples.length === 0
            ? html`<p className="empty-chart">Results appear here after a successful run.</p>`
            : html`
              <${ResponsiveContainer} width="100%" height="100%">
                <${ScatterChart} margin=${{ top: 18, right: 18, bottom: 14, left: 8 }}>
                  <${CartesianGrid} strokeDasharray="3 3" vertical=${false} stroke="#e2e8f0" />
                  <${ReferenceArea} x1=${0.65} x2=${1.35} y1=${stats.rspow.p25 || undefined} y2=${stats.rspow.p75 || undefined} fill=${COLORS.rspow} fillOpacity=${0.1} />
                  <${ReferenceArea} x1=${1.65} x2=${2.35} y1=${stats.nanopow.p25 || undefined} y2=${stats.nanopow.p75 || undefined} fill=${COLORS.nanopow} fillOpacity=${0.1} />
                  <${ReferenceLine} x=${1} stroke="#2563eb" strokeOpacity=${0.18} />
                  <${ReferenceLine} x=${2} stroke="#16a34a" strokeOpacity=${0.18} />
                  ${stats.rspow.count > 0 && html`<${ReferenceLine} y=${stats.rspow.median} stroke=${COLORS.rspow} strokeDasharray="4 4" label=${{ value: `median ${formatDuration(stats.rspow.median)}`, fill: COLORS.rspow, fontSize: 11, position: 'insideTopLeft' }} />`}
                  ${stats.nanopow.count > 0 && html`<${ReferenceLine} y=${stats.nanopow.median} stroke=${COLORS.nanopow} strokeDasharray="4 4" label=${{ value: `median ${formatDuration(stats.nanopow.median)}`, fill: COLORS.nanopow, fontSize: 11, position: 'insideTopRight' }} />`}
                  <${XAxis}
                    dataKey="providerX"
                    name="Provider"
                    type="number"
                    domain=${[0.5, 2.5]}
                    ticks=${[1, 2]}
                    tickFormatter=${(value) => value === 1 ? 'nano-rspow' : 'NanoPow'}
                    tickLine=${false}
                    axisLine=${false}
                    tick=${{ fill: '#64748b', fontSize: 12 }}
                  />
                  <${YAxis}
                    dataKey="elapsedMs"
                    name="Elapsed"
                    scale="log"
                    domain=${['auto', 'auto']}
                    tickLine=${false}
                    axisLine=${false}
                    tick=${{ fill: '#64748b', fontSize: 12 }}
                    width=${70}
                    tickFormatter=${formatDuration}
                    label=${{ value: 'Elapsed time · log scale', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 12 }}
                  />
                  <${Tooltip} cursor=${{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content=${html`<${ScatterTooltip} />`} />
                  <${Scatter} name="nano-rspow" data=${series.rspow} fill=${COLORS.rspow} />
                  <${Scatter} name="NanoPow" data=${series.nanopow} fill=${COLORS.nanopow} />
                </${ScatterChart}>
              </${ResponsiveContainer}>
            `}
        </div>
      </section>

      <section className="stats-grid" aria-label="Distribution summary">
        ${[
          ['rspow', 'nano-rspow', COLORS.rspow, stats.rspow],
          ['nanopow', 'NanoPow', COLORS.nanopow, stats.nanopow],
        ].map(([key, label, color, summary]) => html`
          <article className="stats-card" key=${key}>
            <div className="stats-title"><i style=${{ backgroundColor: color }}></i>${label}</div>
            <strong>${summary.count ? formatDuration(summary.median) : '—'}</strong>
            <span>median</span>
            <dl>
              <div><dt>p25–p75</dt><dd>${summary.count ? `${formatDuration(summary.p25)} – ${formatDuration(summary.p75)}` : '—'}</dd></div>
              <div><dt>range</dt><dd>${summary.count ? `${formatDuration(summary.min)} – ${formatDuration(summary.max)}` : '—'}</dd></div>
              <div><dt>runs</dt><dd>${summary.count}</dd></div>
            </dl>
          </article>
        `)}
      </section>

      <section className="samples-card" aria-label="Recorded benchmark samples">
        <div className="chart-heading">
          <div>
            <p className="eyebrow">Recorded samples</p>
            <h2>Traceable, not averaged away</h2>
          </div>
        </div>
        ${samples.length === 0
          ? html`<p className="empty-samples">No samples yet.</p>`
          : html`
            <ol className="sample-list">
              ${samples.map((sample) => html`
                <li key=${sample.id}>
                  <span className=${`sample-badge ${sample.implementation}`}>${sample.label}</span>
                  <strong>${formatDuration(sample.elapsedMs)}</strong>
                  <span>${sample.mode === 'battle' ? `battle turn ${sample.turn}` : `round ${sample.round}`} · ${sample.backend} · ${sample.nonce}</span>
                </li>
              `)}
            </ol>
          `}
      </section>
    </section>
  `;
}

createRoot(document.getElementById('root')).render(html`<${BenchmarkApp} />`);
