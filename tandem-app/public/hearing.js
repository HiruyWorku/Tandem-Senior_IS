// Hearing callers use shared captions and explicitly sent replies.
(async function init() {
  const roomCode = new URLSearchParams(window.location.search).get('room');
  if (!roomCode) { window.location.href = '/'; return; }
    if (!await window.TandemApp.authorizeInvitation(roomCode)) return;
  const mediaReady = window.TandemApp.initMedia();
  await window.TandemApp.loadIceServers();
  await window.TandemApp.createPeerConnection();
  window.TandemApp.initSocket('hearing', roomCode);
  await mediaReady;
})();
