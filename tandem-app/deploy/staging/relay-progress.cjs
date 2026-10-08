// RTP reports can disappear or be replaced during renegotiation. Comparing
// aggregate lifetime counters then treats a reset as lost media.
function videoAdvanced(current, previous) {
  const prior = new Map(previous.video.map(report => [report.id, report]));
  const received = current.video.some(report => {
    const before = prior.get(report.id);
    if (before && (report.bytes < before.bytes || report.frames < before.frames)) {
      // Chromium can also reset the counters under the same report identity.
      // Independent presented-frame progression still excludes frozen video.
      return report.bytes > 0 && report.frames > 0;
    }
    return report.bytes > (before?.bytes || 0) && report.frames > (before?.frames || 0);
  });
  return received && current.presentedFrames > previous.presentedFrames;
}
module.exports = { videoAdvanced };
