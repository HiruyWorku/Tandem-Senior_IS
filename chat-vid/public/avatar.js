// public/avatar.js
// Loads the pose-viewer web component and exposes window.avatar.setText
// Assumes you serve /public as static from your server.
(async function initAvatar() {
  try {
    const { defineCustomElements } = await import('https://cdn.skypack.dev/pose-viewer/loader');
    if (typeof defineCustomElements === 'function') defineCustomElements(window);
  } catch (e) {
    try {
      const { defineCustomElements } = await import('https://esm.sh/pose-viewer/loader');
      if (typeof defineCustomElements === 'function') defineCustomElements(window);
    } catch (e2) {
      console.error('Failed to load pose-viewer custom element', e, e2);
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
      console.warn('Failed to mount avatar panel, falling back to body append', e);
      try { document.body.appendChild(container); } catch {}
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

  function buildLocalPoseUrl(text, spoken, signed) {
    const qs = new URLSearchParams({ text, spoken, signed }).toString();
    return `/pose?${qs}`;
  }

  // Debounced update
  let debounce;
  async function setText(text, spoken = spokenEl.value, signed = signedEl.value) {
    const trimmed = (text || '').trim();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!trimmed) {
        setStatus('');
        return;
      }
      try {
        setStatus('Rendering avatar…');
        const src = buildLocalPoseUrl(trimmed, spoken, signed);
        if (viewer){
          viewer.setAttribute('src', src);
          // apply playbackRate after updating src: set both attribute and property
          try {
            viewer.setAttribute('playbackRate', String(DEFAULT_PLAYBACK_RATE));
            if (typeof viewer.playbackRate !== 'undefined') viewer.playbackRate = DEFAULT_PLAYBACK_RATE;
          } catch (e) {
            // ignore if unsupported
          }
        }
      } catch (e) {
        console.error(e);
        setStatus('Failed to render.', true);
      }
    }, 400);
  }


  window.avatar = {
    setText, // window.avatar.setText(transcript, 'en', 'ase')
    setSpoken: (v) => (spokenEl.value = v || 'en'),
    setSigned: (v) => (signedEl.value = v || 'ase'),
    getSpoken: () => spokenEl.value,
    getSigned: () => signedEl.value,
  };

  // listen to first render for fps/duration if you need queuing UX
  if (viewer) {
    viewer.addEventListener('firstRender$', async () => {
      try {
        const pose = await viewer.getPose();
        void pose;
      } catch {}
      try {
        viewer.setAttribute('playbackRate', String(DEFAULT_PLAYBACK_RATE));
        if (typeof viewer.playbackRate !== 'undefined') viewer.playbackRate = DEFAULT_PLAYBACK_RATE;
      } catch (e) {
      }
    });
  }

  setStatus('Ready.');
})();
