const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Reserve before submitting audio. Unused credit is never refunded: failed
// requests, replay and short streams all count conservatively toward the cap.
const BLOCK_MS = 15000;
function createDailyCaptionBudget({ file, limitSeconds, now = Date.now }) {
  if (!path.isAbsolute(file || '') || !Number.isInteger(limitSeconds) || limitSeconds < 15 || limitSeconds > 86400) {
    throw new Error('Daily captions require an absolute ledger path and 15–86400 seconds.');
  }
  const limitMs = limitSeconds * 1000;
  const directory = path.dirname(file);
  let seen = false;
  const day = () => new Date(now()).toISOString().slice(0, 10);
  function read() {
    let fd;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 256) throw new Error('Invalid ledger');
      const state = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (state.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(state.day) ||
          !Number.isSafeInteger(state.reservedMs) || state.reservedMs < 0) throw new Error('Invalid ledger');
      seen = true;
      return state;
    } catch (error) {
      if (error.code === 'ENOENT' && !seen) return null;
      throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  function reserve(milliseconds) {
    const lock = file + '.lock';
    let held = false;
    let temporary;
    let fd;
    try {
      // Nonblocking local lock: concurrent writers or a stale lock fail closed.
      fs.mkdirSync(lock, { mode: 0o700 }); held = true;
      const today = day();
      const stored = read();
      if (stored && stored.day > today) throw new Error('Clock moved backward');
      const state = stored?.day === today ? stored : { version: 1, day: today, reservedMs: 0 };
      if (state.reservedMs + milliseconds > limitMs) return { ok: false, reason: 'daily_budget' };
      state.reservedMs += milliseconds;
      temporary = path.join(directory, '.caption-budget-' + randomUUID());
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(state) + '\n');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file); temporary = undefined;
      const parent = fs.openSync(directory, 'r');
      try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
      seen = true;
      return { ok: true, day: today };
    } catch {
      return { ok: false, reason: 'budget_unavailable' };
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (temporary) { try { fs.unlinkSync(temporary); } catch {} }
      if (held) { try { fs.rmdirSync(lock); } catch {} }
    }
  }
  return {
    snapshot() {
      try {
        const today = day(); const state = read();
        if (state && state.day > today) throw new Error('Clock moved backward');
        const reservedSeconds = state?.day === today ? state.reservedMs / 1000 : 0;
        return { available: true, limitSeconds, reservedSeconds,
          remainingSeconds: Math.max(0, limitSeconds - reservedSeconds) };
      } catch {
        return { available: false, limitSeconds, remainingSeconds: 0 };
      }
    },
    open() {
      const initial = reserve(BLOCK_MS);
      if (!initial.ok) return initial;
      let credit = BLOCK_MS;
      let creditDay = initial.day;
      return { ok: true, lease: {
        take(milliseconds) {
          if (!Number.isFinite(milliseconds) || milliseconds <= 0) return { ok: false, reason: 'budget_unavailable' };
          let today;
          try { today = day(); } catch { return { ok: false, reason: 'budget_unavailable' }; }
          if (today !== creditDay) { credit = 0; }
          if (credit < milliseconds) {
            const blocks = Math.ceil((milliseconds - credit) / BLOCK_MS);
            const result = reserve(blocks * BLOCK_MS);
            if (!result.ok) return result;
            creditDay = result.day; credit += blocks * BLOCK_MS;
          }
          credit -= milliseconds;
          return { ok: true };
        },
      } };
    },
  };
}
module.exports = { createDailyCaptionBudget };
