// Explicitly sent messages are the dependable communication fallback.
(function () {
  const form = document.getElementById('replyForm');
  const input = document.getElementById('replyText');
  const status = document.getElementById('replyStatus');
  const send = document.getElementById('replySend');
  const log = document.getElementById('conversationLog');
  const speak = document.getElementById('replySpeak');
  const seen = new Set();
  let joined = false;
  let peerPresent = false;
  let pending = false;
  let retry = null;

  function update() {
    send.disabled = pending || !joined || !peerPresent || !input.value.trim();
  }
  function add(message, local) {
    const key = `${local ? 'local' : 'remote'}:${message.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 200) seen.delete(seen.values().next().value);
    const item = document.createElement('div');
    item.className = 'conversation-message';
    item.dataset.messageId = message.id;
    item.dataset.local = String(local);
    const label = document.createElement('p');
    label.className = 'conversation-sender';
    label.textContent = message.caption ? (local ? 'You · caption' : 'Your peer · caption') : (local ? 'You' : 'Your peer');
    const text = document.createElement('p');
    text.className = 'conversation-text';
    text.dir = 'auto';
    text.textContent = message.text;
    item.append(label, text);
    log.querySelector('.conversation-empty')?.remove();
    log.append(item);
    while (log.children.length > 100) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function attach(socket) {
    const stopAudio = () => log.querySelectorAll('audio').forEach(audio => audio.pause());
    socket.on('joined', data => {
      joined = true;
      peerPresent = data.peers === 2;
      status.textContent = peerPresent ? 'Ready to send.' : 'Your draft stays here while you wait for your peer.';
      update();
    });
    socket.on('room_full', () => {
      joined = false;
      status.textContent = 'This room already has two people. Return home to start another session.';
      update();
    });
    socket.on('invalid_room', () => {
      joined = false;
      status.textContent = 'This room link is invalid. Return home to start a session.';
      update();
    });
    socket.on('ready', () => { peerPresent = true; status.textContent = 'Ready to send.'; update(); });
    socket.on('peer_disconnected', () => {
      stopAudio();
      peerPresent = false;
      const provider = document.getElementById('peerCaptionStatus');
      if (provider) provider.textContent = 'Waiting for your peer…';
      status.textContent = 'Your peer left. Your draft is saved here.';
      update();
    });
    socket.on('disconnect', () => {
      stopAudio();
      joined = false;
      peerPresent = false;
      status.textContent = 'Connection lost. Your draft is saved here.';
      update();
    });
    socket.on('transcript', data => {
      if (data.isFinal && data.transcript) add({ id: data.id || crypto.randomUUID(), text: data.transcript, caption: true }, data.isLocal !== false);
    });
    socket.on('message:received', message => add(message, false));
    socket.on('ttsAudio', data => {
      const item = [...log.children].find(child => child.dataset.messageId === data.messageId && child.dataset.local === 'false');
      if (!item || item.querySelector('audio') || typeof data.audioBase64 !== 'string') return;
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.setAttribute('aria-label', 'Listen to this reply');
      audio.src = `data:audio/mpeg;base64,${data.audioBase64}`;
      audio.addEventListener('ended', () => { if (socket.connected) socket.emit('ttsSpoken'); });
      item.append(audio);
    });
    socket.on('speechStatus', () => { status.textContent = 'Text sent. Speech output is unavailable.'; });
    socket.on('aslDraft', data => {
      const preview = document.getElementById('recognitionDraft');
      const raw = document.getElementById('recognitionRaw');
      const suggestion = document.getElementById('recognitionSuggestion');
      if (!preview) return;
      preview.hidden = false;
      raw.textContent = data.raw;
      suggestion.textContent = data.suggestion;
      preview.dataset.suggestion = data.suggestion;
      const hero = document.getElementById('aslPrediction');
      if (hero) hero.textContent = data.raw;
    });
  }
  window.addEventListener('tandem:socket', event => attach(event.detail));
  document.getElementById('useRecognitionDraft')?.addEventListener('click', () => {
    const preview = document.getElementById('recognitionDraft');
    const word = preview.dataset.suggestion || '';
    input.value = `${input.value.trim()} ${word}`.trim().slice(0, 1000);
    preview.hidden = true;
    retry = null;
    status.textContent = 'Review your reply, then choose Send.';
    input.focus();
    update();
  });
  input.addEventListener('input', () => { retry = null; update(); });
  speak.addEventListener('change', () => { retry = null; });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (send.disabled || !window.socket?.connected) return;
    const text = input.value.trim();
    const original = input.value;
    const message = retry && retry.text === text && retry.speak === speak.checked
      ? retry : { id: crypto.randomUUID(), text, speak: speak.checked };
    retry = message;
    pending = true;
    status.textContent = 'Sending…';
    update();
    window.socket.timeout(5000).emit('message:send', message, (error, result) => {
      pending = false;
      if (error) {
        status.textContent = 'Send was not confirmed. Retry to check without sending a duplicate.';
      } else if (!result?.ok) {
        const errors = { peer_unavailable: 'Your peer is unavailable. Try again when they return.',
          rate_limited: 'Replies are arriving too quickly. Wait a few seconds and try again.',
          not_joined: 'Reconnect to the room, then try again.',
          invalid_message: 'Enter a reply of up to 1,000 characters.' };
        status.textContent = errors[result?.code] || 'Reply could not be sent. Your draft is saved here.';
      } else {
        add(result.message, true);
        // Preserve anything typed while awaiting the acknowledgement.
        if (input.value === original) input.value = '';
        retry = null;
        status.textContent = 'Sent.';
      }
      update();
    });
  });
  fetch('/capabilities').then(response => response.json()).then(capabilities => {
    speak.disabled = !capabilities.speechOutput;
    document.getElementById('speechOutputHint').textContent = capabilities.speechOutput
      ? 'Read this reply aloud to your peer' : 'Speech output is unavailable; text replies still work';
  }).catch(() => {
    speak.disabled = true;
    document.getElementById('speechOutputHint').textContent = 'Could not check speech availability; text replies still work';
  });
  update();
})();
