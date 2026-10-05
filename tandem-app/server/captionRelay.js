/** Deliver provider captions to a peer, merging nearby final results. */
function createCaptionRelay(socket, { holdMs = 600, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let text = '';
  let timer = null;
  let disposed = false;
  return {
    accept(data) {
      if (disposed || !socket.connected || !socket.room || !data.transcript) return;
      if (!data.isFinal) {
        socket.to(socket.room).emit('transcript', { ...data, isLocal: false });
        return;
      }
      clearTimer(timer);
      text = `${text} ${data.transcript}`.trim();
      const room = socket.room;
      timer = setTimer(() => {
        const transcript = text;
        text = '';
        timer = null;
        if (!disposed && socket.connected && socket.room === room && transcript) {
          socket.to(room).emit('transcript', { transcript, isFinal: true, isLocal: false });
        }
      }, holdMs);
    },
    dispose() {
      disposed = true;
      clearTimer(timer);
      timer = null;
      text = '';
    },
  };
}

module.exports = { createCaptionRelay };
