/**
 * liveStreamService.js
 * -------------------------------------------------------------------
 * Real-time live audio streaming via Redis (Upstash REST).
 *
 * Architecture (optimised for low latency):
 *   - Short 400ms recording cycles for near-real-time chunks
 *   - Each chunk is a COMPLETE, independently-playable audio file
 *   - Uses Upstash POST-body API so large payloads work
 *   - Slaves poll every ~450ms and play via Web Audio API (gapless)
 *   - Batch pipeline downloads to reduce round-trips
 * -------------------------------------------------------------------
 */

const REDIS_URL = import.meta.env.VITE_REDIS_REST_URL
const REDIS_TOKEN = import.meta.env.VITE_REDIS_REST_TOKEN

const LIVE_STATE_PREFIX = 'room:live:'
const LIVE_CHUNK_PREFIX = 'room:chunk:'
const CHUNK_TTL = 30       // keep chunks for 30s (short-lived, high frequency)
const STATE_TTL = 1500     // 25 minutes — match room TTL

function baseUrl() { return (REDIS_URL || '').replace(/\/$/, '') }

/**
 * Run an arbitrary Upstash REST command using the POST-body JSON API.
 * This avoids URL length limits for large values.
 */
async function runCommand(args) {
    const res = await fetch(baseUrl(), {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${REDIS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
    })
    if (!res.ok) {
        const t = await res.text()
        console.warn('[Redis]', res.status, t)
        return null
    }
    return res.json()
}

// ─── Pipelined command (multiple commands in one round-trip) ──────────

async function runPipeline(commands) {
    const res = await fetch(`${baseUrl()}/pipeline`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${REDIS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands),
    })
    if (!res.ok) {
        const t = await res.text()
        console.warn('[Redis pipeline]', res.status, t)
        return null
    }
    return res.json()
}

// ─── Live state (JSON, small) ────────────────────────────────────────

export async function setLiveState(roomId, state) {
    await runCommand(['SETEX', `${LIVE_STATE_PREFIX}${roomId}`, STATE_TTL, JSON.stringify(state)])
}

export async function getLiveState(roomId) {
    const json = await runCommand(['GET', `${LIVE_STATE_PREFIX}${roomId}`])
    const raw = json?.result
    if (!raw || raw === 'null') return null
    try { return JSON.parse(raw) } catch { return null }
}

// ─── Audio chunk upload/download ─────────────────────────────────────

// Helper: ArrayBuffer → base64
function arrayBufferToBase64(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer)
    const SLICE = 8192
    let b64 = ''
    for (let i = 0; i < bytes.length; i += SLICE) {
        b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE))
    }
    return btoa(b64)
}

// Helper: base64 → ArrayBuffer
function base64ToArrayBuffer(b64) {
    const binaryStr = atob(b64)
    const len = binaryStr.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
    }
    return bytes.buffer
}

/**
 * Upload a complete audio blob (ArrayBuffer → base64 string) to Redis.
 */
export async function uploadLiveChunk(roomId, seq, arrayBuffer) {
    const b64 = arrayBufferToBase64(arrayBuffer)
    const key = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    return runPipeline([
        ['SETEX', key, CHUNK_TTL, b64],
    ])
}

/**
 * Upload the chunk AND update the live state atomically in one round-trip.
 */
export async function uploadChunkAndState(roomId, seq, arrayBuffer, stateObj) {
    const b64 = arrayBufferToBase64(arrayBuffer)
    const chunkKey = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const stateKey = `${LIVE_STATE_PREFIX}${roomId}`
    return runPipeline([
        ['SETEX', chunkKey, CHUNK_TTL, b64],
        ['SETEX', stateKey, STATE_TTL, JSON.stringify(stateObj)],
    ])
}

/**
 * Download a chunk. Returns an ArrayBuffer or null.
 */
export async function downloadLiveChunk(roomId, seq) {
    const key = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const json = await runCommand(['GET', key])
    const b64 = json?.result
    if (!b64) return null
    return base64ToArrayBuffer(b64)
}

/**
 * Download chunk + get state in a single pipeline request.
 */
export async function downloadChunkAndState(roomId, seq) {
    const chunkKey = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const stateKey = `${LIVE_STATE_PREFIX}${roomId}`

    const results = await runPipeline([
        ['GET', chunkKey],
        ['GET', stateKey],
    ])

    if (!results || !Array.isArray(results)) return { chunk: null, state: null }

    let chunk = null
    const b64 = results[0]?.result
    if (b64 && b64 !== 'null') {
        chunk = base64ToArrayBuffer(b64)
    }

    let state = null
    const stateRaw = results[1]?.result
    if (stateRaw && stateRaw !== 'null') {
        try { state = JSON.parse(stateRaw) } catch { state = null }
    }

    return { chunk, state }
}

/**
 * Download multiple chunks + state in a SINGLE pipeline request.
 * Reduces round-trips when fetching several sequential chunks.
 * Returns { chunks: [{seq, arrayBuffer}, ...], state }
 */
export async function downloadMultipleChunksAndState(roomId, seqs) {
    const commands = seqs.map(seq => ['GET', `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`])
    commands.push(['GET', `${LIVE_STATE_PREFIX}${roomId}`])

    const results = await runPipeline(commands)
    if (!results || !Array.isArray(results)) return { chunks: [], state: null }

    const chunks = []
    for (let i = 0; i < seqs.length; i++) {
        const b64 = results[i]?.result
        if (b64 && b64 !== 'null') {
            chunks.push({ seq: seqs[i], arrayBuffer: base64ToArrayBuffer(b64) })
        }
    }

    let state = null
    const stateRaw = results[results.length - 1]?.result
    if (stateRaw && stateRaw !== 'null') {
        try { state = JSON.parse(stateRaw) } catch { state = null }
    }

    return { chunks, state }
}
