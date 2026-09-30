import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
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
} from 'recharts';
import initNanoRspow, { generate_work as generateNanoRspow } from './nano_rspow_web.js';
import { validateWork } from 'nanocurrency';
import * as NanoPowModule from 'nano-pow';

const html = htm.bind(React.createElement);

const CURRENT_SEND_THRESHOLD = 'fffffff800000000';
const NANOPOW_OPTIONS = { difficulty: CURRENT_SEND_THRESHOLD };
const BATTLE_TURNS = 42;
const BATTLE_COOLDOWN_MS = 200;
const COLORS = {
  rspow: '#2563eb',
  rpc: '#d97706',
  nanopow: '#16a34a',
  node: '#9333ea',
};
const CORE_PROVIDERS = [
  { key: 'rspow', label: 'nano-rspow-web', version: '0.10.0', color: COLORS.rspow, thresholdKey: 'threshold' },
  { key: 'node', label: 'nano-rspow-node', version: 'local', color: COLORS.node, thresholdKey: 'threshold' },
  { key: 'rpc', label: 'nano-rspow (RPC)', version: 'local', color: COLORS.rpc, thresholdKey: 'difficulty' },
];
const COMPETITORS = [
  { key: 'nanopow', label: 'nano-pow', version: '5.2.2', color: COLORS.nanopow, thresholdKey: 'difficulty' },
  { key: 'nanocurrency', label: 'nanocurrency', version: '2.5.0', color: '#d97706', thresholdKey: 'difficulty' },
  { key: 'webglPow', label: 'nano-webgl-pow', version: '1.1.1', color: '#9333ea', thresholdKey: 'difficulty' },
];
const NanoPow = NanoPowModule.NanoPow ?? NanoPowModule.default;

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
      <small>${sample.mode === 'battle' ? `battle turn ${sample.providerTurn}/${sample.turnsPerProvider}` : `round ${sample.round}`} · root ${sample.root.slice(0, 12)}…</small>
    </div>
  `;
}

function ScatterPoint({ cx, cy, fill, payload, highlighted }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const className = highlighted ? 'sample-point sample-point--latest' : 'sample-point';
  return html`
    <g className=${className} style=${{ '--point-color': fill }} aria-hidden="true">
      ${highlighted ? html`<circle className="sample-point-glow" cx=${cx} cy=${cy} r="8" fill=${fill} />` : null}
      <circle className="sample-point-dot" cx=${cx} cy=${cy} r="4" fill=${fill} />
    </g>
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
  const [highlightedSampleId, setHighlightedSampleId] = useState(null);
  const [message, setMessage] = useState('Loading nano-rspow WebAssembly and local providers…');
  const [competitorIndex, setCompetitorIndex] = useState(0);
  const [battle, setBattle] = useState({ running: false, stopRequested: false, completed: 0, current: null });
  const [battleRootState, setBattleRootState] = useState(null);
  const battleStopRef = useRef(false);
  const highlightTimerRef = useRef(null);
  const currentProviders = useMemo(() => [...CORE_PROVIDERS, COMPETITORS[competitorIndex]], [competitorIndex]);
  const providerByKey = useMemo(() => Object.fromEntries(currentProviders.map((p) => [p.key, p])), [currentProviders]);
  const [battleProviders, setBattleProviders] = useState(() => new Set(
    currentProviders.map((provider) => provider.key),
  ));

  useEffect(() => {
    setBattleProviders((previous) => {
      const hadVisibleCompetitor = [...previous].some((key) => COMPETITORS.some((competitor) => competitor.key === key));
      const next = new Set([...previous].filter((key) => !COMPETITORS.some((competitor) => competitor.key === key)));
      if (hadVisibleCompetitor) next.add(COMPETITORS[competitorIndex].key);
      return next;
    });
  }, [competitorIndex]);

  useEffect(() => {
    Promise.all([
      initNanoRspow(),
      fetch('/api/health').then(async (response) => {
        const health = await response.json();
        if (!response.ok || !health.rpc.ready || !health.node.ready) {
          throw new Error(health.error ?? 'native bridge is not ready');
        }
      }),
    ])
      .then(() => {
        setReady(true);
        setMessage('Ready. Run the solvers against round 1’s work root.');
      })
      .catch((error) => {
        setInitializationError(error instanceof Error ? error.message : String(error));
        setMessage('A local PoW provider could not initialize.');
      });

  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const recordSample = (sample) => {
    setSamples((previous) => [...previous, sample]);
    setHighlightedSampleId(sample.id);
    if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedSampleId((current) => (current === sample.id ? null : current));
      highlightTimerRef.current = null;
    }, 300);
  };

  const series = useMemo(() => Object.fromEntries(currentProviders.map((provider, providerIndex) => [
    provider.key,
    samples
      .filter((sample) => sample.implementation === provider.key)
      .map((sample, index) => ({ ...sample, providerX: 1 + (((index * (37 + providerIndex * 16)) % 11) - 5) / 100 })),
  ])), [samples, currentProviders]);

  const stats = useMemo(() => Object.fromEntries(currentProviders.map((provider) => [
    provider.key,
    distributionStats(series[provider.key]),
  ])), [series, currentProviders]);

  const sharedYDomain = useMemo(() => {
    const values = samples.map((sample) => sample.elapsedMs).filter((value) => value > 0);
    if (values.length === 0) return ['auto', 'auto'];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    return [Math.max(1, minimum / 1.35), maximum * 1.35];
  }, [samples]);

  const solveNative = async (path, workRoot) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: workRoot, threshold: CURRENT_SEND_THRESHOLD }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `native bridge returned ${response.status}`);
    return result;
  };

  const finishRoundIfComplete = (implementation) => {
    setCompletedInRound((previous) => {
      const next = new Set(previous);
      next.add(implementation);
      if (next.size === currentProviders.length) {
        setRound((value) => value + 1);
        setRoot(randomRoot());
        setMessage(`Round ${round} complete. A new shared work root is ready.`);
        return new Set();
      }
      setMessage(`Recorded ${providerByKey[implementation].label}. Run another solver with this same root.`);
      return next;
    });
  };

  const solve = async (implementation, workRoot) => {
    const provider = providerByKey[implementation];
    const timer = `[PoW] ${provider.label} ${performance.now().toFixed(1)}ms`;
    const startedAt = performance.now();
    let nonce;
    let backend;
    let elapsedMs;

    console.groupCollapsed(`${timer} start`);
    console.info('root', workRoot, 'threshold', CURRENT_SEND_THRESHOLD);
    console.time(timer);
    try {
      if (implementation === 'rspow') {
        const result = await generateNanoRspow(workRoot, CURRENT_SEND_THRESHOLD);
        nonce = result.nonce;
        backend = result.is_gpu ? 'WebGPU' : 'CPU WASM fallback';
      } else if (implementation === 'nanopow') {
        const result = await NanoPow.work_generate(workRoot, NANOPOW_OPTIONS);
        nonce = result.work;
        backend = result.api ?? 'automatic API selection';
      } else {
        const result = await solveNative(implementation === 'rpc' ? '/api/pow/rpc' : '/api/pow/node', workRoot);
        nonce = result.work;
        if (implementation === 'rpc') {
          if (!result._benchmark) throw new Error('nano-rspow (RPC) proxy response omitted _benchmark metadata');
          backend = result._benchmark.backend;
          elapsedMs = result._benchmark.providerMs;
        } else {
          backend = result.backend;
          elapsedMs = result.providerMs;
        }
      }

      const isValid = validateWork({
        blockHash: workRoot,
        work: nonce,
        threshold: CURRENT_SEND_THRESHOLD,
      });
      console.assert(isValid, `${provider.label} returned invalid current send work`, { workRoot, nonce });
      if (!isValid) throw new Error(`${provider.label} returned work below the current send threshold`);

      elapsedMs ??= performance.now() - startedAt;
      console.info('finished and validated', { nonce, backend, elapsedMs });
      return { elapsedMs, nonce, backend };
    } catch (error) {
      console.error('failed', error);
      throw error;
    } finally {
      console.timeEnd(timer);
      console.groupEnd();
    }
  };

  const runBenchmark = async (implementation) => {
    if (!ready || active || completedInRound.has(implementation)) return;

    setActive(implementation);
    setMessage(`Running ${providerByKey[implementation].label} at the current send threshold…`);
    try {
      const { elapsedMs, nonce, backend } = await solve(implementation, root);
      const label = providerByKey[implementation].label;
      recordSample({
        id: `round-${round}-${implementation}`,
        implementation,
        label,
        round,
        elapsedMs,
        root,
        nonce,
        backend,
      });
      finishRoundIfComplete(implementation);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(`${providerByKey[implementation].label} failed: ${detail}`);
    } finally {
      setActive(null);
    }
  };

  const runBattle = async () => {
    if (!ready || active || battle.running) return;

    const selectedProviders = currentProviders.filter((provider) => battleProviders.has(provider.key));
    if (selectedProviders.length === 0) {
      setMessage('Select at least one provider to include in the battle.');
      return;
    }

    battleStopRef.current = false;
    setActive('battle');
    setBattle({ running: true, stopRequested: false, completed: 0, current: selectedProviders[0].key });

    let battleRoot = root;
    setBattleRootState(battleRoot);
    const totalTurns = BATTLE_TURNS * selectedProviders.length;
    let completed = 0;
    try {
      for (let turn = 1; turn <= totalTurns; turn += 1) {
        if (battleStopRef.current) break;

        const implementation = selectedProviders[(turn - 1) % selectedProviders.length].key;
        const providerTurn = Math.floor((turn - 1) / selectedProviders.length) + 1;
        const label = providerByKey[implementation].label;
        setBattle((previous) => ({ ...previous, current: implementation, completed }));
        setMessage(`Battle turn ${providerTurn}/${BATTLE_TURNS} for ${label} (${turn}/${totalTurns} total)…`);

        const { elapsedMs, nonce, backend } = await solve(implementation, battleRoot);
        recordSample({
          id: `battle-${turn}-${implementation}`,
          implementation,
          label,
          mode: 'battle',
          turn,
          providerTurn,
          turnsPerProvider: BATTLE_TURNS,
          elapsedMs,
          root: battleRoot,
          nonce,
          backend,
        });

        completed = turn;
        battleRoot = battleRootFromNonce(nonce);
        setBattleRootState(battleRoot);
        setBattle((previous) => ({ ...previous, completed }));

        if (turn < totalTurns && !battleStopRef.current) {
          setMessage(`Battle turn ${providerTurn}/${BATTLE_TURNS} for ${label} recorded (${turn}/${totalTurns} total). Cooling down for ${BATTLE_COOLDOWN_MS} ms…`);
          await sleep(BATTLE_COOLDOWN_MS);
        }
      }

      setMessage(battleStopRef.current
        ? `Battle stopped after ${completed} of ${totalTurns} total turns.`
        : `Battle complete: ${BATTLE_TURNS} turns per provider (${totalTurns} total) recorded.`);
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
    const activeLabel = providerByKey[battle.current]?.label ?? 'the active provider';
    setMessage(`Stopping… ${activeLabel} is allowed to finish its current work search before the battle ends.`);
  };

  const toggleBattleProvider = (implementation) => {
    setBattleProviders((previous) => {
      const next = new Set(previous);
      if (next.has(implementation)) next.delete(implementation);
      else next.add(implementation);
      return next;
    });
  };

  const buttonState = (implementation) => {
    if (runningImplementation === implementation) return providerByKey[implementation].label;
    if (completedInRound.has(implementation)) return `${providerByKey[implementation].label} • recorded`;
    return providerByKey[implementation].label;
  };

  const isDisabled = (implementation) => !ready
    || Boolean(active)
    || !battleProviders.has(implementation)
    || completedInRound.has(implementation);
  const runningImplementation = active === 'battle' ? battle.current : active;
  const runningThresholdKey = providerByKey[runningImplementation]?.thresholdKey ?? 'threshold';
  const displayedRoot = battle.running && battleRootState ? battleRootState : root;
  const selectedBattleProviderCount = currentProviders.filter((provider) => battleProviders.has(provider.key)).length;
  const totalBattleTurns = BATTLE_TURNS * selectedBattleProviderCount;

  return html`
    <section className="page-shell">
      <header className="hero">
        <p className="eyebrow">Browser benchmark · current send</p>
        <h1>One work root and four PoW engines.</h1>
        <p className="lede">
          Each round uses the same random root and records elapsed wall-clock time.
          Runs are intentionally serialized: GPU and CPU pressure should belong to one solver at a time.
        </p>
      </header>

      <section className="control-card" aria-label="Benchmark controls">
        <div className="round-meta">
          <span className="round-label">${battle.running ? `Battle turn ${Math.min(battle.completed + 1, totalBattleTurns)}/${totalBattleTurns} total` : `Round ${round}`}</span>
          <code title=${displayedRoot}>${displayedRoot}</code>
          <span className="threshold">Current send ${runningThresholdKey} ${CURRENT_SEND_THRESHOLD}</span>
        </div>
        <div className="button-row">
          ${currentProviders.map((provider, idx) => html`
            <div className="provider-control" key=${provider.key}>
              ${idx === currentProviders.length - 1 && COMPETITORS.length > 1 ? html`
                <div className="competitor-selector">
                  <button className="competitor-arrow" onClick=${() => setCompetitorIndex((i) => (i - 1 + COMPETITORS.length) % COMPETITORS.length)} aria-label="Previous competitor">‹</button>
                  <button
                    className=${`benchmark-button button-${provider.key} ${runningImplementation === provider.key ? 'is-active' : ''} ${completedInRound.has(provider.key) ? 'is-recorded' : ''} ${isDisabled(provider.key) ? 'is-disabled' : ''}`}
                    disabled=${isDisabled(provider.key)}
                    onClick=${() => runBenchmark(provider.key)}
                  >
                    <span className="status-led"></span><span className="button-text" key=${buttonState(provider.key)}>${buttonState(provider.key)}</span>
                  </button>
                  <button className="competitor-arrow" onClick=${() => setCompetitorIndex((i) => (i + 1) % COMPETITORS.length)} aria-label="Next competitor">›</button>
                </div>
              ` : html`
                <button
                  className=${`benchmark-button button-${provider.key} ${runningImplementation === provider.key ? 'is-active' : ''} ${completedInRound.has(provider.key) ? 'is-recorded' : ''} ${isDisabled(provider.key) ? 'is-disabled' : ''}`}
                  disabled=${isDisabled(provider.key)}
                  onClick=${() => runBenchmark(provider.key)}
                >
                  <span className="status-led"></span><span className="button-text" key=${buttonState(provider.key)}>${buttonState(provider.key)}</span>
                </button>
              `}
              <label className="battle-inclusion" title="Include in battle">
                <input
                  type="checkbox"
                  aria-label=${`Include ${provider.label} in battle`}
                  checked=${battleProviders.has(provider.key)}
                  disabled=${Boolean(active)}
                  onChange=${() => toggleBattleProvider(provider.key)}
                />
              </label>
            </div>
          `)}
        </div>
        <button
          className=${`battle-button ${battle.running ? 'is-running' : ''} ${battle.stopRequested ? 'is-stopping' : ''}`}
          disabled=${!ready || battleProviders.size === 0 || Boolean(active && !battle.running) || battle.stopRequested}
          onClick=${battle.running ? stopBattle : runBattle}
        >
          <span className="button-label button-text" key=${battle.running ? battle.stopRequested ? 'stopping' : 'stop' : 'start'}>
            ${battle.running
              ? battle.stopRequested ? 'Stopping…' : 'Stop!'
              : 'Start battle'}
          </span>
        </button>
        <p className="battle-note">
          ${BATTLE_TURNS} turns per provider (${totalBattleTurns} total with the current selection; ${BATTLE_COOLDOWN_MS} ms between turns), cycling through the selected providers.
          Each result becomes the next work root.
        </p>
        <p className=${initializationError ? 'status status-error' : 'status'} aria-live="polite">
          ${message}
        </p>
      </section>

      <section className="plots-grid" aria-label="Provider runtime distribution plots">
        ${currentProviders.map((provider) => {
          const summary = stats[provider.key];
          return html`
            <article className="chart-card provider-chart" key=${provider.key}>
              <div className="chart-heading">
                <div>
                  <p className="eyebrow">Results</p>
                  <h2>${provider.label}</h2>
                  <p className="chart-note">p25–p75 band · median line</p>
                </div>
              </div>
              <div className="chart-frame">
                ${summary.count === 0
                  ? html`<p className="empty-chart">No runs yet.</p>`
                  : html`
                    <${ResponsiveContainer} width="100%" height="100%">
                      <${ScatterChart} margin=${{ top: 18, right: 12, bottom: 10, left: 0 }}>
                        <${CartesianGrid} strokeDasharray="3 3" vertical=${false} stroke="#e2e8f0" />
                        <${ReferenceArea} x1=${0.65} x2=${1.35} y1=${summary.p25} y2=${summary.p75} fill=${provider.color} fillOpacity=${0.1} />
                        <${ReferenceLine} x=${1} stroke=${provider.color} strokeOpacity=${0.18} />
                        <${ReferenceLine} y=${summary.median} stroke=${provider.color} strokeDasharray="4 4" label=${{ value: formatDuration(summary.median), fill: provider.color, fontSize: 11, position: 'insideTopLeft' }} />
                        <${XAxis} hide dataKey="providerX" type="number" domain=${[0.5, 1.5]} />
                        <${YAxis} dataKey="elapsedMs" scale="log" domain=${sharedYDomain} tickLine=${false} axisLine=${false} tick=${{ fill: '#64748b', fontSize: 11 }} width=${58} tickFormatter=${formatDuration} />
                        <${Tooltip} cursor=${{ strokeDasharray: '3 3', stroke: '#94a3b8' }} content=${html`<${ScatterTooltip} />`} />
                        <${Scatter}
                          name=${provider.label}
                          data=${series[provider.key]}
                          fill=${provider.color}
                          shape=${(point) => html`<${ScatterPoint} ...${point} highlighted=${point.payload?.id === highlightedSampleId} />`}
                        />
                      </${ScatterChart}>
                    </${ResponsiveContainer}>
                  `}
              </div>
              <div className="chart-stats">
                <div className="chart-stat-primary">
                  <span>median</span>
                  <strong>${summary.count ? formatDuration(summary.median) : '—'}</strong>
                </div>
                <dl>
                  <div><dt>version</dt><dd>v${provider.version}</dd></div>
                  <div><dt>p25–p75</dt><dd>${summary.count ? `${formatDuration(summary.p25)} – ${formatDuration(summary.p75)}` : '—'}</dd></div>
                  <div><dt>range</dt><dd>${summary.count ? `${formatDuration(summary.min)} – ${formatDuration(summary.max)}` : '—'}</dd></div>
                  <div><dt>runs</dt><dd>${summary.count}</dd></div>
                </dl>
              </div>
            </article>
          `;
        })}
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
                  <span>${sample.mode === 'battle' ? `battle turn ${sample.providerTurn}/${sample.turnsPerProvider}` : `round ${sample.round}`} · ${sample.backend} · ${sample.nonce}</span>
                </li>
              `)}
            </ol>
          `}
      </section>
    </section>
  `;
}

createRoot(document.getElementById('root')).render(html`<${BenchmarkApp} />`);
