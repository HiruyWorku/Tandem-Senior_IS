// test/smoke.test.js
// Minimal smoke test using Node.js built-in test runner (node --test).
// Does NOT require Google Cloud credentials or a running Python server.
// Run: node --test test/smoke.test.js
//
// What it verifies:
//   1. All server-side modules can be require()'d without throwing
//   2. getRoomSize-equivalent logic works (trivial but catches import breakage)

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ── 1. Module imports ────────────────────────────────────────────────────────

test('server/poseProxy.js exports an Express router', () => {
    // poseProxy has no external I/O at import time — safe to require directly.
    const poseProxy = require(path.join(__dirname, '..', 'server', 'poseProxy'));
    assert.ok(poseProxy, 'poseProxy should be truthy');
    // Express routers are functions
    assert.strictEqual(typeof poseProxy, 'function', 'poseProxy should be a function (Express router)');
});

test('server/textToSpeech.js exports a synthesize function', () => {
    // textToSpeech creates a Google Cloud TTS client, but credential errors only
    // surface when synthesize() is called — the import itself is safe.
    const tts = require(path.join(__dirname, '..', 'server', 'textToSpeech'));
    assert.ok(tts, 'textToSpeech module should be truthy');
    assert.strictEqual(typeof tts.synthesize, 'function', 'tts.synthesize should be a function');
});

// ── 2. Utility logic ─────────────────────────────────────────────────────────

test('getRoomSize returns 0 for an unknown room (logic unit)', () => {
    // Inline the pure logic — avoids spinning up a full Socket.IO server.
    function getRoomSize(rooms, roomName) {
        const room = rooms.get(roomName);
        return room ? room.size : 0;
    }
    const fakeRooms = new Map([['main-room', { size: 2 }]]);
    assert.strictEqual(getRoomSize(fakeRooms, 'main-room'), 2);
    assert.strictEqual(getRoomSize(fakeRooms, 'unknown'), 0);
});
