// public/avatar.js
// Loads the pose-viewer web component and exposes window.avatar.setText
// Assumes you serve /public as static from your server.
(async function initAvatar() {
  const { invitationHeaders } = await import('/invitation.js');
  let poseObjectUrl;
  window.addEventListener('pagehide', () => { if (poseObjectUrl) URL.revokeObjectURL(poseObjectUrl); });
  try {
    const response = await fetch('/capabilities');
    if (!(await response.json()).avatar) return;
    const section = document.getElementById('avatarSection');
    if (section) section.hidden = false;
  } catch { return; }
  try {
    const { defineCustomElements } = await import('https://cdn.skypack.dev/pose-viewer/loader');
    if (typeof defineCustomElements !== 'function') throw new Error('Signing viewer loader is unavailable.');
    await defineCustomElements(window);
  } catch (e) {
    try {
      const { defineCustomElements } = await import('https://esm.sh/pose-viewer/loader');
      if (typeof defineCustomElements !== 'function') throw new Error('Signing viewer loader is unavailable.');
      await defineCustomElements(window);
    } catch (e2) {
      console.error('Signing viewer could not be loaded.');
      const panel = document.getElementById('avatar-panel');
      if (panel) {
        const message = document.createElement('p');
        message.className = 'reply-hint avatar-unavailable'; message.setAttribute('role', 'status');
        message.textContent = 'Signing viewer unavailable. You can still type replies.';
        panel.replaceChildren(message);
      }
      // A missing viewer cannot display poses. Do not submit conversation text
      // to the pose service or leave a queue pretending it can render.
      return;
    }
  }

  // Insert the panel below your cameras if not already present.
  let container = document.getElementById('avatar-panel');
  if (!container) {
    container = document.createElement('div');
    container.id = 'avatar-panel';
  }

  // If container exists but is empty, inject inner markup
  if (!container.querySelector('#avatar-viewer')) {
    container.innerHTML = `
      <div id="avatar-header">Signing Avatar</div>
      <div id="avatar-controls">
        <label class="select">
          Spoken:
          <select id="avatar-spoken">
            <option value="en" selected>English (en)</option>
          </select>
        </label>
        <label class="select">
          Signed:
          <select id="avatar-signed">
            <option value="ase" selected>ASL (ase)</option>
          </select>
        </label>
      </div>
      <pose-viewer id="avatar-viewer" autoplay></pose-viewer>
      <div id="avatar-status"></div>
    `;
  }

  // Ensure it sits below the video section if not already in DOM
  if (!document.body.contains(container)) {
    const mount = document.querySelector('main.videos') || document.body;
    try {
      // Prefer appending after the videos section
      if (mount && mount.insertAdjacentElement) {
        mount.insertAdjacentElement('afterend', container);
      } else if (document.body && document.body.appendChild) {
        document.body.appendChild(container);
      }
    } catch (e) {
      console.warn('Signing viewer panel could not be mounted.');
      try { document.body.appendChild(container); } catch { }
    }
  }

  const viewer = container.querySelector('#avatar-viewer');
  const statusEl = container.querySelector('#avatar-status');
  const spokenEl = container.querySelector('#avatar-spoken');
  const signedEl = container.querySelector('#avatar-signed');

  // default playback for pose-viewer
  const DEFAULT_PLAYBACK_RATE = 3.0;

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.style.color = isError ? '#fca5a5' : '#a8a8a8';
  }


  // ---------------------------------------------------------------------------
  // SigningQueue — ensures utterances are rendered one at a time, in order.
  //
  // The pose-viewer web component does not expose a stable cross-browser
  // "playback ended" event, so we estimate each utterance's duration as:
  //   words × MS_PER_WORD, clamped to [MIN_DURATION, MAX_DURATION] ms.
  // When pose-viewer fires `firstRender$` we reset the timer to that moment
  // so any fetch/parse delay before rendering begins does not count against
  // the signing window.
  // ---------------------------------------------------------------------------
  const MS_PER_WORD = 2000;  // ~2 s per sign-word at 3× playback
  const MIN_DURATION = 2500;  // never less than 2.5 s even for a single word
  const MAX_DURATION = 20000; // cap at 20 s for very long sentences

  function estimateDuration(text) {
    const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 1;
    return Math.min(MAX_DURATION, Math.max(MIN_DURATION, words * MS_PER_WORD));
  }

  class SigningQueue {
    constructor() {
      this._generation = 0;
      this._queue = [];   // Array<{text, spoken, signed}>
      this._playing = false;
      this._timer = null;
      this._request = null;
      this._clearFirstRender = null;
    }

    /** Add an utterance to the queue and start playback if idle. */
    enqueue(text, spoken = 'en', signed = 'ase') {
      const trimmed = (text || '').trim();
      if (!trimmed) return;
      this._queue.push({ text: trimmed, spoken, signed });
      if (!this._playing) this._flush();
    }

    /** Immediately clear the queue and stop the current animation. */
    interrupt() {
      this._generation++;
      this._queue = [];
      clearTimeout(this._timer);
      this._request?.abort();
      this._clearFirstRender?.();
      this._clearFirstRender = null;
      this._playing = false;
      this._hasPlayed = false;
      viewer?.removeAttribute('src');
      if (poseObjectUrl) URL.revokeObjectURL(poseObjectUrl);
      poseObjectUrl = null;
      setStatus('');
    }

    async _flush() {
      const generation = this._generation;
      this._clearFirstRender?.();
      this._clearFirstRender = null;
      if (this._queue.length === 0) {
        this._playing = false;
        setStatus('');
        // Notify the hearing peer that the avatar finished signing.
        if (this._hasPlayed) {
          if (window.socket && window.socket.connected) {
            window.socket.emit('signingDone');
          }
          this._hasPlayed = false;
        }
        return;
      }
      this._hasPlayed = true;

      this._playing = true;
      const { text, spoken, signed } = this._queue.shift();
      const duration = estimateDuration(text);
      const request = new AbortController();
      this._request = request;
      const deadline = setTimeout(() => request.abort(), 10000);

      try {
        setStatus('Signing…');
        const response = await fetch('/pose', { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...invitationHeaders() },
          body: JSON.stringify({ text, spoken, signed }), signal: request.signal });
        if (!response.ok) throw new Error('Signing unavailable.');
        const blob = await response.blob();
        if (generation !== this._generation) return;
        const src = URL.createObjectURL(blob);
        if (poseObjectUrl) URL.revokeObjectURL(poseObjectUrl);
        poseObjectUrl = src;
        if (viewer) {
          viewer.setAttribute('src', src);
          try {
            viewer.setAttribute('playbackRate', String(DEFAULT_PLAYBACK_RATE));
            if (typeof viewer.playbackRate !== 'undefined')
              viewer.playbackRate = DEFAULT_PLAYBACK_RATE;
          } catch (_) { /* ignore if unsupported */ }
        }
      } catch (e) {
        if (generation !== this._generation) return;
        console.error('Signing render failed.');
        setStatus('Failed to render.', true);
        // Still advance the queue so one bad item doesn't stall everything.
        this._scheduleNext(500);
        return;
      } finally {
        clearTimeout(deadline);
        if (this._request === request) this._request = null;
      }

      // Primary completion signal: pose-viewer fires `firstRender$` when the
      // first frame is drawn. We (re)start the duration timer at that point so
      // network fetch time doesn't consume signing time.
      let timerStarted = false;
      const onFirstRender = () => {
        if (timerStarted || generation !== this._generation) return;
        timerStarted = true;
        clearTimeout(this._timer);
        this._scheduleNext(duration);
      };

      if (viewer) {
        viewer.addEventListener('firstRender$', onFirstRender, { once: true });
        this._clearFirstRender = () => viewer.removeEventListener('firstRender$', onFirstRender);
      }

      // Fallback: if firstRender$ never fires (e.g. network error or
      // unsupported browser), advance after duration + a generous fetch buffer.
      this._scheduleNext(duration + 3000, () => {
        if (viewer) viewer.removeEventListener('firstRender$', onFirstRender);
      });
    }

    _scheduleNext(ms, onFire) {
      const generation = this._generation;
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        if (generation !== this._generation) return;
        if (onFire) onFire();
        this._flush();
      }, ms);
    }
  }

  const queue = new SigningQueue();
  window.addEventListener('pagehide', () => queue.interrupt());

  /**
   * setText — drop-in replacement for the old debounced setter.
   * Callers that want queue semantics should prefer `enqueue()` directly.
   * Here we keep setText as an alias so existing call-sites keep working;
   * it simply delegates to enqueue.
   */
  function setText(text, spoken = spokenEl.value, signed = signedEl.value) {
    queue.enqueue(text, spoken, signed);
  }

  /** Public enqueue: add a single utterance to the signing queue. */
  function enqueue(text, spoken = spokenEl.value, signed = signedEl.value) {
    queue.enqueue(text, spoken, signed);
  }

  /** Public interrupt: clear the queue and halt the current animation. */
  function interrupt() {
    queue.interrupt();
  }


  window.avatar = {
    setText,    // window.avatar.setText(text, spoken, signed)  — queues the utterance
    enqueue,    // window.avatar.enqueue(text, spoken, signed)  — explicit queue API
    interrupt,  // window.avatar.interrupt()                   — clear queue + stop
    setSpoken: (v) => (spokenEl.value = v || 'en'),
    setSigned: (v) => (signedEl.value = v || 'ase'),
    getSpoken: () => spokenEl.value,
    getSigned: () => signedEl.value,
  };

  // listen to first render for fps/duration 
  if (viewer) {
    viewer.addEventListener('firstRender$', async () => {
      try {
        const pose = await viewer.getPose();
        void pose;
      } catch { }
      try {
        viewer.setAttribute('playbackRate', String(DEFAULT_PLAYBACK_RATE));
        if (typeof viewer.playbackRate !== 'undefined') viewer.playbackRate = DEFAULT_PLAYBACK_RATE;
      } catch (e) {
      }
    });
  }

  setStatus('Ready.');
})();
