/** Device IDs remain in this page; choosing hardware never records or persists them. */
export class DeviceSettings {
  constructor({ getStream, allowed, pending, apply }) {
    Object.assign(this, { getStream, allowed, pending, apply });
    this.panel = document.getElementById('deviceSettings');
    this.toggle = document.getElementById('toggleDevices');
    this.form = document.getElementById('deviceForm');
    this.camera = document.getElementById('cameraDevice');
    this.microphone = document.getElementById('microphoneDevice');
    this.status = document.getElementById('deviceStatus');
    this.submit = document.getElementById('applyDevices');
    this.sidebar = this.panel?.closest('.call-sidebar');
    this.refreshGeneration = 0;
    this.loading = false;
    this.disposed = false;
    this.toggle?.addEventListener('click', () => this.panel.hidden ? this.open() : this.close());
    document.getElementById('closeDevices')?.addEventListener('click', () => this.close(true));
    this.panel?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(true); }
    });
    this.form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (this.disposed || !this.allowed() || this.pending() || this.loading) return;
      const generation = this.refreshGeneration;
      this.status.textContent = 'Opening selected camera and microphone…';
      const success = await this.apply({ videoId: this.camera.value, audioId: this.microphone.value });
      if (this.disposed || !this.allowed() || generation !== this.refreshGeneration) return;
      this.status.textContent = success ? 'Your selected devices are in use.' :
        'Could not open that selection. Check camera and microphone access, or choose another device.';
      this.update();
    });
    this.onDeviceChange = () => { if (!this.panel.hidden) this.refresh(); };
    navigator.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    this.update();
  }

  update() {
    if (!this.toggle) return;
    const accessible = this.allowed() && !this.disposed;
    this.toggle.disabled = !accessible;
    if (!accessible) this.close();
    const busy = !accessible || this.pending() || this.loading;
    for (const control of [this.camera, this.microphone, this.submit]) control.disabled = busy;
    this.submit.textContent = this.pending() ? 'Waiting for devices…' : 'Use selected devices';
  }

  open() {
    if (!this.allowed() || this.disposed || !this.panel) return;
    this.panel.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.sidebar.classList.add('devices-open');
    // Initial selection describes the current tracks. Later edits stay selected
    // through hardware changes rather than silently choosing another camera.
    const stream = this.getStream();
    this.camera.value = stream?.getVideoTracks()[0]?.getSettings().deviceId || '';
    this.microphone.value = stream?.getAudioTracks()[0]?.getSettings().deviceId || '';
    this.refresh(true);
    document.getElementById('deviceSettingsTitle')?.focus();
  }

  close(returnFocus = false) {
    if (!this.panel) return;
    this.panel.hidden = true;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.sidebar.classList.remove('devices-open');
    this.refreshGeneration++;
    this.loading = false;
    if (returnFocus && !this.toggle.disabled) this.toggle.focus();
  }

  async refresh(fromCurrent = false) {
    const generation = ++this.refreshGeneration;
    const stream = this.getStream();
    const chosen = fromCurrent ? [stream?.getVideoTracks()[0]?.getSettings().deviceId || '',
      stream?.getAudioTracks()[0]?.getSettings().deviceId || ''] : [this.camera.value, this.microphone.value];
    this.loading = true;
    this.status.textContent = 'Finding your devices…';
    this.update();
    let timer;
    try {
      const devices = await Promise.race([navigator.mediaDevices.enumerateDevices(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Device discovery timed out')), 5000);
      })]);
      if (generation !== this.refreshGeneration || this.disposed || !this.allowed()) return;
      for (const [index, select, kind, name] of [[0, this.camera, 'videoinput', 'Camera'], [1, this.microphone, 'audioinput', 'Microphone']]) {
        select.replaceChildren(new Option('Browser default', ''));
        const unique = new Set();
        const inputs = devices.filter(device => device.kind === kind && device.deviceId &&
          !['default', 'communications'].includes(device.deviceId));
        for (const device of inputs) {
          if (unique.has(device.deviceId)) continue;
          unique.add(device.deviceId);
          select.add(new Option(device.label || `${name} ${unique.size}`, device.deviceId));
        }
        if (chosen[index] && !unique.has(chosen[index])) {
          const missing = new Option('Selected device unavailable', chosen[index]);
          missing.disabled = true; select.add(missing);
        }
        select.value = chosen[index];
      }
      this.status.textContent = 'Choose devices, then use your selection. Device names appear after you allow access.';
    } catch {
      if (generation === this.refreshGeneration && !this.disposed && this.allowed()) {
        this.status.textContent = 'Device list unavailable. You can still use Browser default, or close and retry.';
      }
    } finally {
      clearTimeout(timer);
      if (generation === this.refreshGeneration) { this.loading = false; this.update(); }
    }
  }

  dispose() {
    this.disposed = true;
    navigator.mediaDevices?.removeEventListener('devicechange', this.onDeviceChange);
    this.update();
  }

  restore() {
    if (!this.disposed) return;
    this.disposed = false;
    navigator.mediaDevices?.addEventListener('devicechange', this.onDeviceChange);
    this.update();
  }
}
