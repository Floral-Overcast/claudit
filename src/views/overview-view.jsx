// Overview: the default tab. One screen, no scrolling on a desktop
// viewport — window totals, per-prompt averages, spend per day, cost by
// model, cost by project. The full panel set lives on the Analytics tab.
//
// Data: /api/overview (rollup-backed) + the projects list App already
// holds for the picker. Re-fetches on project/range change and on the
// SSE ingest nonce, like the other panels.

const { useState: ovUseState, useEffect: ovUseEffect, useMemo: ovUseMemo, useRef: ovUseRef } = React;

// Decode a project id back into something a person recognises.
// Claude Code encodes "/" as "-" in project dir names; our mirror layout
// optionally prefixes "<host>-". Ambiguous for path segments that
// themselves contain dashes, so the raw id stays in the tooltip.
//   "-Users-seol-dev"   -> "/Users/seol/dev"
//   "cloud--root-hub"   -> "cloud /root/hub"
//   "pc-C--Users-Seol"  -> "pc C:/Users/Seol"
function prettyProject(name) {
  if (!name) return name;
  let m = name.match(/^([^-]+)-([A-Za-z])--(.+)$/); // host + drive path
  if (m) return `${m[1]} ${m[2]}:/${m[3].replace(/-/g, '/')}`;
  m = name.match(/^([^-]+)-(-.+)$/);                 // host + unix path
  if (m) return `${m[1]} ${m[2].replace(/-/g, '/')}`;
  m = name.match(/^([A-Za-z])--(.+)$/);              // bare drive path
  if (m) return `${m[1]}:/${m[2].replace(/-/g, '/')}`;
  if (name.startsWith('-')) return name.replace(/-/g, '/'); // bare unix path
  return name;
}
window.prettyProject = prettyProject;

function OvStat({ label, value, sub, highlight }) {
  return (
    <div className={'ov-stat' + (highlight ? ' ov-stat-hl' : '')}>
      <div className="ov-stat-label">{label}</div>
      <div className="ov-stat-value">{value}</div>
      {sub != null && <div className="ov-stat-sub">{sub}</div>}
    </div>
  );
}

// Single-series, single-axis daily cost bars. Rounded 3px data ends
// anchored to the baseline, >=2px gaps, recessive grid, per-bar hover
// tooltip, direct label on the peak day only.
function DailyBars({ daily }) {
  const ref = ovUseRef(null);
  const [w, setW] = ovUseState(800);
  const [hover, setHover] = ovUseState(null); // index | null

  ovUseEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(es => setW(es[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Fill calendar gaps with zero-cost days so quiet days read as quiet
  // instead of silently vanishing from the x axis.
  const days = ovUseMemo(() => {
    if (!daily || !daily.length) return [];
    const out = [];
    const DAY = 86400000;
    let t = Date.parse(daily[0].day);
    const byTs = new Map(daily.map(d => [Date.parse(d.day), d]));
    const end = Date.parse(daily[daily.length - 1].day);
    for (; t <= end; t += DAY) {
      const d = byTs.get(t);
      out.push({ ts: t, cost: d ? d.cost_usd : 0 });
    }
    return out;
  }, [daily]);

  if (!days.length) return <div className="ov-empty">no usage in range</div>;

  const H = 220, padL = 46, padR = 10, padT = 18, padB = 26;
  const plotW = Math.max(50, w - padL - padR);
  const plotH = H - padT - padB;
  const max = Math.max(...days.map(d => d.cost), 0.01);
  const maxIdx = days.reduce((mi, d, i) => (d.cost > days[mi].cost ? i : mi), 0);
  const bw = plotW / days.length;
  const barW = Math.max(2, Math.min(38, bw - 2));
  const yTicks = [0, 0.5, 1].map(f => f * max);
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));

  const x = i => padL + i * bw + (bw - barW) / 2;
  const y = v => padT + plotH * (1 - v / max);

  return (
    <div className="ov-chart" ref={ref}>
      <svg width={w} height={H}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)}
              stroke="var(--border)" strokeWidth="1" />
            <text x={padL - 8} y={y(v) + 4} textAnchor="end" className="ov-tick">
              {window.humanFmt(v, true)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const bh = Math.max(d.cost > 0 ? 2 : 0, plotH * (d.cost / max));
          const r = Math.min(3, barW / 2, bh);
          const top = padT + plotH - bh;
          return (
            <g key={d.ts}>
              {/* rounded top corners only; base sits on the axis */}
              {bh > 0 && (
                <path d={`M ${x(i)} ${top + r}
                          a ${r} ${r} 0 0 1 ${r} ${-r}
                          h ${barW - 2 * r}
                          a ${r} ${r} 0 0 1 ${r} ${r}
                          v ${bh - r}
                          h ${-barW} z`}
                  fill="var(--accent)"
                  opacity={hover == null || hover === i ? 0.92 : 0.45} />
              )}
              {/* hit target wider than the mark */}
              <rect x={padL + i * bw} y={padT} width={bw} height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)} />
              {i % labelEvery === 0 && (
                <text x={x(i) + barW / 2} y={H - 8} textAnchor="middle" className="ov-tick">
                  {window.fmtDate(d.ts, { day: true })}
                </text>
              )}
              {i === maxIdx && d.cost > 0 && hover == null && (
                <text x={x(i) + barW / 2} y={top - 6} textAnchor="middle" className="ov-peak">
                  {window.humanFmt(d.cost, true)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={padL} x2={w - padR} y1={padT + plotH} y2={padT + plotH}
          stroke="var(--border-2)" strokeWidth="1" />
      </svg>
      {hover != null && days[hover] && (
        <div className="ov-tip" style={{
          left: Math.min(x(hover) + barW / 2, w - 130),
          top: y(days[hover].cost) - 40,
        }}>
          <div className="ov-tip-date">{window.fmtDate(days[hover].ts, { day: true })}</div>
          <div className="ov-tip-val">{window.humanCurrency(days[hover].cost)}</div>
        </div>
      )}
    </div>
  );
}

function OverviewView({ project, range, nonce, projects, isGuest }) {
  const [data, setData] = ovUseState(null);
  const [err, setErr] = ovUseState('');

  ovUseEffect(() => {
    const q = project ? `&project=${encodeURIComponent(project)}` : '';
    fetch(`/api/overview?range=${encodeURIComponent(range)}${q}`, { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error('overview fetch failed'); return r.json(); })
      .then(b => { setData(b); setErr(''); })
      .catch(e => setErr(String(e.message || e)));
  }, [project, range, nonce]);

  if (err) return <div className="ov-wrap"><div className="ov-empty">{err}</div></div>;
  if (!data) return <div className="ov-wrap"><div className="ov-empty">loading…</div></div>;

  const t = data.totals, pp = data.per_prompt;
  const daily = data.daily || [];
  const last = daily.length ? daily[daily.length - 1] : null;
  const lastIsToday = last &&
    new Date(Date.parse(last.day)).toDateString() === new Date().toDateString();

  const modelRows = (data.cost_by_model || []).map(r => {
    const shortName = window.shortModelName ? window.shortModelName(r.model) : r.model;
    return { label: shortName, value: r.cost_usd };
  }).reduce((acc, r) => {           // fold dated variants of one model together
    const hit = acc.find(a => a.label === r.label);
    if (hit) hit.value += r.value; else acc.push({ ...r });
    return acc;
  }, []).sort((a, b) => b.value - a.value);

  const projRows = (projects || [])
    .filter(p => p.total_cost > 0)
    .slice(0, 8)
    .map(p => ({
      label: prettyProject(p.display_name),
      value: p.total_cost,
      color: 'var(--accent)',
      title: p.project_id,
    }));

  const totalTokens = t.input_tokens + t.output_tokens + t.cache_create_tokens + t.cache_read_tokens;

  return (
    <div className="ov-wrap">
      <div className="ov-stats">
        <OvStat label="cost" value={window.humanFmt(t.cost_usd, true)} highlight
          sub={`${range === 'all' ? 'all time' : 'last ' + range}`} />
        <OvStat label={lastIsToday ? 'today' : 'last active day'}
          value={last ? window.humanFmt(last.cost_usd, true) : '$0'}
          sub={last && !lastIsToday ? window.fmtDate(Date.parse(last.day), { day: true }) : 'spend'} />
        <OvStat label="prompts" value={t.prompts.toLocaleString()}
          sub={`${t.sessions.toLocaleString()} sessions`} />
        <OvStat label="output tokens" value={window.humanFmt(t.output_tokens)}
          sub={`of ${window.humanFmt(totalTokens)} total`} />
        <OvStat label="requests" value={t.requests.toLocaleString()}
          sub={`${t.tool_calls.toLocaleString()} tool calls`} />
      </div>

      <div className="ov-row-main">
        <div className="ov-card">
          <div className="ov-card-title">Spend per day (USD)</div>
          <DailyBars daily={daily} />
        </div>
        <div className="ov-card ov-card-flush">
          <window.HBar
            embedded
            title="Cost by Model"
            rows={modelRows}
            fixedColors={window.modelColors}
            fmt={r => window.humanCurrency(r.value)} />
        </div>
      </div>

      <div className="ov-row-second">
        <div className="ov-card">
          <div className="ov-card-title">Per prompt <span className="ov-card-note">averages over {t.prompts.toLocaleString()} prompts</span></div>
          <div className="ov-pp">
            <OvStat label="cost" value={'$' + pp.cost_usd.toFixed(2)} />
            <OvStat label="output tokens" value={window.humanFmt(pp.output_tokens)} />
            <OvStat label="tool calls" value={pp.tool_calls.toFixed(1)} />
            <OvStat label="file reads" value={pp.file_reads.toFixed(1)} />
            <OvStat label="memory reads" value={pp.memory_reads.toFixed(2)} />
          </div>
        </div>
        {!isGuest && projRows.length > 0 && (
          <div className="ov-card ov-card-flush">
            <window.HBar
              embedded
              title="Cost by Project (all time)"
              rows={projRows}
              fmt={r => window.humanCurrency(r.value)} />
          </div>
        )}
      </div>
    </div>
  );
}

window.OverviewView = OverviewView;
