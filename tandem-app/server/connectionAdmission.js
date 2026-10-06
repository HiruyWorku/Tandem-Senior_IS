/** Bound namespace admission, including sockets not yet registered by Socket.IO. */
function createConnectionAdmission({ maxConnections, unjoinedTimeoutMs,
  isDraining = () => false, setTimer = setTimeout, clearTimer = clearTimeout,
  telemetry = { record() {} } }) {
  const reserved = new Set();
  return (socket, next) => {
    if (isDraining() || reserved.size >= maxConnections) {
      telemetry.record('connection_rejected');
      const error = new Error('Server is busy. Try again later.');
      error.data = { code: 'server_busy' };
      return next(error);
    }
    reserved.add(socket.id);
    let timer;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reserved.delete(socket.id);
      clearTimer(timer);
      socket.off('disconnect', release);
      socket.conn.off('close', release);
    };
    const check = () => {
      if (released) return;
      if (!socket.room) {
        telemetry.record('connection_idle_closed');
        socket.conn.close(true);
        release();
        return;
      }
      timer = setTimer(check, unjoinedTimeoutMs);
      timer.unref?.();
    };
    // Transport close also releases a reservation abandoned before namespace connect.
    socket.once('disconnect', release);
    socket.conn.once('close', release);
    timer = setTimer(check, unjoinedTimeoutMs);
    timer.unref?.();
    next();
  };
}

/** Socket.IO's graceful polling close can wait for a client that never polls again. */
function closeUnadmittedTransports(io, { unjoinedTimeoutMs, telemetry = { record() {} } }) {
  io.engine.on('connection', transport => {
    const timer = setTimeout(() => {
      transport.off('close', closed);
      if (transport.readyState === 'closed') return;
      const admitted = [...io.sockets.sockets.values()].some(socket => socket.conn === transport);
      if (!admitted) {
        telemetry.record('connection_idle_closed');
        transport.close(true);
      }
    }, unjoinedTimeoutMs);
    const closed = () => clearTimeout(timer);
    transport.once('close', closed);
    timer.unref?.();
  });
}

module.exports = { createConnectionAdmission, closeUnadmittedTransports };
