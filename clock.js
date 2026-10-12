// Logika zegara meczowego. Czas liczony od znaczników czasu (a nie tyknięć),
// więc działa po zablokowaniu ekranu, w tle i po ponownym otwarciu aplikacji.

const PERIODS = ['1. połowa', '2. połowa', '1. połowa dogrywki', '2. połowa dogrywki'];
const HALF_LENGTH_OPTIONS = [20, 25, 30, 35, 40, 45];
const EXTRA_TIME_OPTIONS = [5, 10, 15];
const STORAGE_KEY = 'zegarMeczu.state';

function defaultState(halfLength = 45, extraTimeLength = 15) {
  return {
    halfLength,            // minuty
    extraTimeLength,       // minuty
    period: 0,             // indeks w PERIODS
    phase: 'ready',        // ready | running | paused | finished
    accumulated: 0,        // ms okresu sprzed ostatniego startu
    startedAt: null,       // ms (Date.now())
    breakStartedAt: null,
    alerted: false,        // czy był już sygnał końca regulaminowego czasu w tym okresie
    results: [],           // [{ period, duration }]
  };
}

class MatchClock {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.state = defaultState();
    try {
      const saved = JSON.parse(storage?.getItem(STORAGE_KEY));
      if (saved && typeof saved.phase === 'string') this.state = { ...defaultState(), ...saved };
    } catch {}
  }

  // ---- Odczyty ----

  get period() { return this.state.period; }
  get phase() { return this.state.phase; }
  get periodName() { return PERIODS[this.state.period]; }
  get hasStarted() { return !(this.state.period === 0 && this.state.phase === 'ready'); }
  get canStartExtraTime() { return this.state.phase === 'finished' && this.state.period === 1; }
  get isRunningOrPaused() { return this.state.phase === 'running' || this.state.phase === 'paused'; }

  isExtraTime(p) { return p >= 2; }

  length(p = this.state.period) {
    return (this.isExtraTime(p) ? this.state.extraTimeLength : this.state.halfLength) * 60000;
  }

  /** Czas meczowy, od którego startuje okres (np. 2. połowa od 45:00). */
  offset(p = this.state.period) {
    switch (p) {
      case 0: return 0;
      case 1: return this.length(0);
      case 2: return 2 * this.length(0);
      default: return 2 * this.length(0) + this.length(2);
    }
  }

  periodElapsed(now = Date.now()) {
    let t = this.state.accumulated;
    if (this.state.phase === 'running' && this.state.startedAt != null) t += now - this.state.startedAt;
    return Math.max(0, t);
  }

  matchElapsed(now = Date.now()) { return this.offset() + this.periodElapsed(now); }
  addedTime(now = Date.now()) { return Math.max(0, this.periodElapsed(now) - this.length()); }
  progress(now = Date.now()) { return Math.min(1, this.periodElapsed(now) / this.length()); }

  breakElapsed(now = Date.now()) {
    if (this.state.phase !== 'ready' || this.state.breakStartedAt == null) return null;
    return Math.max(0, now - this.state.breakStartedAt);
  }

  // ---- Akcje ----

  start(now = Date.now()) {
    if (this.state.phase !== 'ready' && this.state.phase !== 'paused') return;
    this.update(s => { s.phase = 'running'; s.startedAt = now; s.breakStartedAt = null; });
  }

  pause(now = Date.now()) {
    if (this.state.phase !== 'running') return;
    const elapsed = this.periodElapsed(now);
    this.update(s => { s.accumulated = elapsed; s.startedAt = null; s.phase = 'paused'; });
  }

  endPeriod(now = Date.now()) {
    if (!this.isRunningOrPaused) return;
    const result = { period: this.state.period, duration: this.periodElapsed(now) };
    const next = { 0: 1, 2: 3 }[this.state.period];
    this.update(s => {
      s.results.push(result);
      s.startedAt = null;
      if (next !== undefined) {
        Object.assign(s, { period: next, accumulated: 0, phase: 'ready', breakStartedAt: now, alerted: false });
      } else {
        Object.assign(s, { accumulated: result.duration, phase: 'finished' });
      }
    });
  }

  startExtraTime(now = Date.now()) {
    if (!this.canStartExtraTime) return;
    this.update(s => Object.assign(s, { period: 2, accumulated: 0, phase: 'ready', breakStartedAt: now, alerted: false }));
  }

  /** Ręczna korekta, np. gdy zegar włączono z opóźnieniem. */
  adjust(ms, now = Date.now()) {
    if (!this.isRunningOrPaused) return;
    const delta = Math.max(ms, -this.periodElapsed(now));
    this.update(s => {
      s.accumulated += delta;
      if (this.periodElapsed(now) < this.length()) s.alerted = false;
    });
  }

  markAlerted() { this.update(s => { s.alerted = true; }); }

  setHalfLength(min) { if (!this.hasStarted) this.update(s => { s.halfLength = min; }); }
  setExtraTimeLength(min) { if (!this.isExtraTime(this.state.period)) this.update(s => { s.extraTimeLength = min; }); }

  newMatch() {
    const { halfLength, extraTimeLength } = this.state;
    this.update(s => Object.assign(s, defaultState(halfLength, extraTimeLength)));
  }

  update(change) {
    change(this.state);
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch {}
  }
}

const ClockFormat = {
  /** Minuty nie zawijają się po 60: 67:12, 90:00, 104:30. */
  clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  },
  added(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  /** Minuta jak w relacjach: 1' … 45', potem 45+1', 45+2' … */
  matchMinute(periodElapsed, offset, length) {
    if (periodElapsed < length) return `${Math.floor((offset + periodElapsed) / 60000) + 1}'`;
    return `${Math.floor((offset + length) / 60000)}+${Math.floor((periodElapsed - length) / 60000) + 1}'`;
  },
};
