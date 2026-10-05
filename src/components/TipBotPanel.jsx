import React, { useEffect, useMemo, useState } from 'react';

const emptySettings = {
  numberTipEnabled: true,
  maxTip: -1,
  limit: -1,
  rateLimit: -1,
  random: { enabled: false, min: 1, max: 100 },
  guessGame: { enabled: false, target: 0, guesses: 0 },
  regexTip: { enabled: false, pattern: '', perMatch: 1 },
  buy: { enabled: false, limit: -1, minPackage: -1, maxPackage: -1 },
};

function send(type, payload = undefined, extra = {}) {
  window.postMessage({ source: 'tip-bot-ui', type, payload, ...extra }, '*');
}

function asField(value) {
  return value === undefined || value === null ? '' : String(value);
}

function normalizeStatus(status) {
  const settings = status?.settings || emptySettings;
  return {
    settings: {
      ...emptySettings,
      ...settings,
      random: { ...emptySettings.random, ...(settings.random || {}) },
      guessGame: { ...emptySettings.guessGame, ...(settings.guessGame || {}) },
      regexTip: { ...emptySettings.regexTip, ...(settings.regexTip || {}) },
      buy: { ...emptySettings.buy, ...(settings.buy || {}) },
    },
    currentlyTipped: status?.currentlyTipped || 0,
    currentlyBought: status?.currentlyBought || 0,
    tokensInLastMinute: status?.tokensInLastMinute || 0,
    availableToTip: status?.availableToTip ?? null,
    repeatActive: !!status?.repeatActive,
    buyAvailable: Array.isArray(status?.buyAvailable) ? status.buyAvailable : [],
    spending: status?.spending || { today: 0, period: 0, total: 0, recentDays: [] },
    spendingLoading: !!status?.spendingLoading,
  };
}

function toDraft(settings) {
  return {
    numberTipEnabled: settings.numberTipEnabled !== false,
    maxTip: asField(settings.maxTip),
    limit: asField(settings.limit),
    rateLimit: asField(settings.rateLimit),
    random: {
      enabled: !!settings.random.enabled,
      min: asField(settings.random.min),
      max: asField(settings.random.max),
    },
    guessGame: {
      enabled: !!settings.guessGame.enabled,
      target: asField(settings.guessGame.target),
    },
    regexTip: {
      enabled: !!settings.regexTip.enabled,
      pattern: settings.regexTip.pattern || '',
      perMatch: asField(settings.regexTip.perMatch),
    },
    buy: {
      enabled: !!settings.buy.enabled,
      limit: asField(settings.buy.limit),
      minPackage: asField(settings.buy.minPackage),
      maxPackage: asField(settings.buy.maxPackage),
    },
  };
}

function Field({ label, value, onChange, width = 'w-20' }) {
  return (
    <label className="flex items-center justify-between gap-3 text-slate-300">
      <span>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="-?[0-9]*"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${width} appearance-none rounded-lg border border-white/10 bg-slate-950/80 px-2 py-1 text-right font-mono tabular-nums text-slate-100 outline-none ring-cyan-400/40 transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2`}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 text-slate-200">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-cyan-400' : 'bg-slate-700'}`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-6' : 'left-1'}`}
        />
      </button>
    </label>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-inner shadow-black/10">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export default function TipBotPanel() {
  const [status, setStatus] = useState(() => normalizeStatus(null));
  const [draft, setDraft] = useState(() => toDraft(emptySettings));
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    function onMessage(event) {
      if (event.source !== window || event.data?.source !== 'tip-bot-page' || event.data.type !== 'state') return;
      const nextStatus = normalizeStatus(event.data.payload);
      setStatus(nextStatus);
      if (!dirty) setDraft(toDraft(nextStatus.settings));
    }

    function onToggle() {
      setOpen((value) => !value);
    }

    window.addEventListener('message', onMessage);
    window.addEventListener('tip-bot-ui:toggle', onToggle);
    send('state:request');

    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('tip-bot-ui:toggle', onToggle);
    };
  }, [dirty]);

  const update = (updater) => {
    setDraft((current) => (typeof updater === 'function' ? updater(current) : updater));
    setDirty(true);
    setSaved(false);
  };

  const statusLine = useMemo(() => {
    const parts = [
      `Available ${status.availableToTip === null ? 'n/a' : `${status.availableToTip} tk`}`,
      `Tipped ${status.currentlyTipped} tk`,
    ];
    if (status.settings.rateLimit !== -1) parts.push(`${status.tokensInLastMinute}/${status.settings.rateLimit}/min`);
    if (status.repeatActive) parts.push('repeating');
    if (status.settings.guessGame.enabled) parts.push(`guess ${status.settings.guessGame.guesses || 0}/3`);
    return parts.join(' · ');
  }, [status]);

  if (!open) return null;

  return (
    <div className="tip-bot-root fixed right-5 top-20 z-[2147483647] w-[360px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/95 text-sm text-slate-100 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-3">
        <div>
          <div className="text-base font-semibold tracking-tight">Tip Bot</div>
          <div className="text-xs text-slate-400">WXT · React · Tailwind</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded-lg bg-white/10 px-2 py-1 text-slate-300 hover:bg-white/15" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? '+' : '−'}
          </button>
          <button className="rounded-lg bg-white/10 px-2 py-1 text-slate-300 hover:bg-white/15" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-[calc(100vh-120px)] space-y-3 overflow-y-auto p-4">
          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-100">{statusLine}</div>

          <Section title="Tipping">
            <Toggle label="Number tips" checked={draft.numberTipEnabled} onChange={(value) => update((d) => ({ ...d, numberTipEnabled: value }))} />
            <Field label="Max tip" value={draft.maxTip} onChange={(value) => update((d) => ({ ...d, maxTip: value }))} />
            <Field label="Limit" value={draft.limit} onChange={(value) => update((d) => ({ ...d, limit: value }))} />
            <Field label="Rate / min" value={draft.rateLimit} onChange={(value) => update((d) => ({ ...d, rateLimit: value }))} />
            <p className="text-xs text-slate-500">Use -1 for unlimited.</p>
          </Section>

          <Section title="Games">
            <Toggle label="Random" checked={draft.random.enabled} onChange={(value) => update((d) => ({ ...d, random: { ...d.random, enabled: value } }))} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min" value={draft.random.min} width="w-16" onChange={(value) => update((d) => ({ ...d, random: { ...d.random, min: value } }))} />
              <Field label="Max" value={draft.random.max} width="w-16" onChange={(value) => update((d) => ({ ...d, random: { ...d.random, max: value } }))} />
            </div>
            <Toggle label="Guess game" checked={draft.guessGame.enabled} onChange={(value) => update((d) => ({ ...d, guessGame: { ...d.guessGame, enabled: value } }))} />
            <Field label="Target" value={draft.guessGame.target} onChange={(value) => update((d) => ({ ...d, guessGame: { ...d.guessGame, target: value } }))} />
            <p className="text-xs text-slate-500">Exact guesses tip double and reset; third guess tips if below target.</p>
          </Section>

          <Section title="Regex">
            <Toggle label="Regex tipping" checked={draft.regexTip.enabled} onChange={(value) => update((d) => ({ ...d, regexTip: { ...d.regexTip, enabled: value } }))} />
            <label className="block text-slate-300">
              <span className="mb-1 block">Pattern</span>
              <input
                value={draft.regexTip.pattern}
                onChange={(event) => update((d) => ({ ...d, regexTip: { ...d.regexTip, pattern: event.target.value } }))}
                placeholder="."
                className="w-full rounded-lg border border-white/10 bg-slate-950/80 px-2 py-1 text-slate-100 outline-none ring-cyan-400/40 transition focus:ring-2"
              />
            </label>
            <Field label="Tk / match" value={draft.regexTip.perMatch} onChange={(value) => update((d) => ({ ...d, regexTip: { ...d.regexTip, perMatch: value } }))} />
          </Section>

          <Section title="Buying">
            <Toggle label="Allow buying" checked={draft.buy.enabled} onChange={(value) => update((d) => ({ ...d, buy: { ...d.buy, enabled: value } }))} />
            <Field label="Buy limit" value={draft.buy.limit} onChange={(value) => update((d) => ({ ...d, buy: { ...d.buy, limit: value } }))} />
            <Field label="Min package" value={draft.buy.minPackage} onChange={(value) => update((d) => ({ ...d, buy: { ...d.buy, minPackage: value } }))} />
            <Field label="Max package" value={draft.buy.maxPackage} onChange={(value) => update((d) => ({ ...d, buy: { ...d.buy, maxPackage: value } }))} />
            <p className="text-xs text-slate-500">Available: {status.buyAvailable.length ? status.buyAvailable.join(' · ') : 'none'}</p>
            <p className="text-xs text-amber-200">Bought {status.currentlyBought}{status.settings.buy.limit !== -1 ? `/${status.settings.buy.limit}` : ''} tk</p>
          </Section>

          <Section title="Spending">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-xs text-slate-500">Today</div><div className="font-semibold">{status.spending.today}</div></div>
              <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-xs text-slate-500">14 days</div><div className="font-semibold">{status.spending.period}</div></div>
              <div className="rounded-xl bg-white/[0.04] p-2"><div className="text-xs text-slate-500">Tracked</div><div className="font-semibold">{status.spending.total}</div></div>
            </div>
            <div className="max-h-24 overflow-y-auto text-xs text-slate-400">
              {(status.spending.recentDays || []).map((day) => (
                <div key={day.date} className="flex justify-between border-b border-white/5 py-1"><span>{day.date}</span><span>{day.amount} tk</span></div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button className="rounded-xl bg-slate-700 px-3 py-2 font-medium hover:bg-slate-600" onClick={() => send('spending:refresh')}>
                {status.spendingLoading ? 'Loading…' : 'Refresh'}
              </button>
              <button className="rounded-xl bg-slate-800 px-3 py-2 font-medium hover:bg-slate-700" onClick={() => send('spending:refresh', undefined, { full: true })}>
                Rebuild
              </button>
            </div>
          </Section>

          <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-slate-950/95 pt-2">
            <button
              className="rounded-2xl bg-cyan-400 px-4 py-3 font-semibold text-slate-950 shadow-lg shadow-cyan-950/40 hover:bg-cyan-300 disabled:opacity-60"
              disabled={!dirty && !saved}
              onClick={() => {
                send('settings:update', draft);
                setDirty(false);
                setSaved(true);
                setTimeout(() => setSaved(false), 1200);
              }}
            >
              {saved ? 'Saved ✓' : dirty ? 'Apply' : 'Saved'}
            </button>
            <button className="rounded-2xl bg-rose-500 px-4 py-3 font-semibold text-white hover:bg-rose-400" onClick={() => send('repeat:stop')}>
              Stop repeat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
