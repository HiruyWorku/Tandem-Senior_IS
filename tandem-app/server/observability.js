const { timingSafeEqual } = require('node:crypto');
const EVENTS = new Set(['room_joined', 'room_rejected', 'message_sent', 'speech_job_failed',
  'connection_rejected', 'connection_idle_closed',
  'speech_started', 'speech_rotated', 'speech_replayed', 'speech_retry', 'speech_unavailable', 'speech_limited', 'audio_dropped',
  'avatar_provider_failed', 'ice_issued', 'ice_denied', 'client_ice_renewed', 'client_ice_failed', 'client_media_failed', 'http_failed']);

/** Fixed aggregate counters only: no identifiers, content, URLs, or free-form labels. */
function createObservability({ env = {}, now = Date.now, logger = event => console.warn(JSON.stringify(event)) } = {}) {
  if (env.METRICS_TOKEN && Buffer.byteLength(env.METRICS_TOKEN) < 32) throw new Error('METRICS_TOKEN must contain at least 32 bytes.');
  const counters = new Map([...EVENTS].map(event => [event, 0]));
  const started = now();
  const buckets = [0.01, 0.05, 0.1, 0.5, 1, 5];
  const latency = buckets.map(() => 0);
  let requests = 0;
  let durationSum = 0;
  return {
    observe(duration) {
      if (!Number.isFinite(duration) || duration < 0) return;
      requests++; durationSum += duration;
      buckets.forEach((bucket, index) => { if (duration <= bucket) latency[index]++; });
    },
    enabled: Boolean(env.METRICS_TOKEN),
    record(event) { if (EVENTS.has(event)) counters.set(event, counters.get(event) + 1); },
    failure(event, code) {
      if (!EVENTS.has(event)) return;
      counters.set(event, counters.get(event) + 1);
      const safeCode = Number.isInteger(code) && code >= 0 && code <= 599 ? code : 'unknown';
      logger({ event, code: safeCode });
    },
    authorized(header) {
      if (!env.METRICS_TOKEN || typeof header !== 'string' || header.length > 512) return false;
      const actual = Buffer.from(header);
      const expected = Buffer.from(`Bearer ${env.METRICS_TOKEN}`);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    },
    render({ sockets = 0, rooms = 0, streams = 0, jobs = 0, ready = true } = {}) {
      const memory = process.memoryUsage();
      const lines = ['# HELP tandem_events_total Aggregate application events.', '# TYPE tandem_events_total counter'];
      for (const [event, count] of counters) lines.push(`tandem_events_total{event="${event}"} ${count}`);
      lines.push('# TYPE tandem_http_duration_seconds histogram');
      buckets.forEach((bucket, index) => lines.push(`tandem_http_duration_seconds_bucket{le="${bucket}"} ${latency[index]}`));
      lines.push(`tandem_http_duration_seconds_bucket{le="+Inf"} ${requests}`,
        `tandem_http_duration_seconds_sum ${durationSum}`, `tandem_http_duration_seconds_count ${requests}`);
      for (const [name, value] of Object.entries({ ready: Number(ready), sockets, rooms, caption_streams: streams,
        provider_jobs: jobs, uptime_seconds: Math.max(0, now() - started) / 1000,
        heap_bytes: memory.heapUsed, resident_bytes: memory.rss })) {
        lines.push(`# TYPE tandem_${name} gauge`, `tandem_${name} ${value}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}
module.exports = { createObservability };
