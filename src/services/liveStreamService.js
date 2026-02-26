/**
 * liveStreamService.js
 * -------------------------------------------------------------------
 * Real-time live audio streaming via Redis (Upstash REST).
 *
 * Architecture (optimised for low latency):
 *   - Short 500ms recording cycles for near-real-time chunks
 *   - Each chunk is a COMPLETE, independently-playable audio file
 *   - Uses Upstash POST-body API so large payloads work
 *   - Slaves poll every ~600ms and play via blob URLs (faster than data URIs)
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

/**
 * Upload a complete audio blob (ArrayBuffer → base64 string) to Redis.
 * Uses the POST-body API so there's no URL length limit.
 */
export async function uploadLiveChunk(roomId, seq, arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer)
    // Convert to base64 in chunks to avoid call-stack overflow on large buffers
    const SLICE = 8192
    let b64 = ''
    for (let i = 0; i < bytes.length; i += SLICE) {
        b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE))
    }
    b64 = btoa(b64)

    const key = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`

    // Pipeline: SETEX chunk + SETEX state in a single round-trip
    // This halves the network latency for each cycle
    return runPipeline([
        ['SETEX', key, CHUNK_TTL, b64],
    ])
}

/**
 * Upload the chunk AND update the live state atomically in one round-trip.
 */
export async function uploadChunkAndState(roomId, seq, arrayBuffer, stateObj) {
    const bytes = new Uint8Array(arrayBuffer)
    const SLICE = 8192
    let b64 = ''
    for (let i = 0; i < bytes.length; i += SLICE) {
        b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + SLICE))
    }
    b64 = btoa(b64)

    const chunkKey = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const stateKey = `${LIVE_STATE_PREFIX}${roomId}`

    // Single pipeline = one HTTP request for both operations
    return runPipeline([
        ['SETEX', chunkKey, CHUNK_TTL, b64],
        ['SETEX', stateKey, STATE_TTL, JSON.stringify(stateObj)],
    ])
}

/**
 * Download a chunk. Returns an ArrayBuffer (for blob URL creation) or null.
 */
export async function downloadLiveChunk(roomId, seq) {
    const key = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const json = await runCommand(['GET', key])
    const b64 = json?.result
    if (!b64) return null

    // Decode base64 → ArrayBuffer
    const binaryStr = atob(b64)
    const len = binaryStr.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
    }
    return bytes.buffer
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

    // Parse chunk
    let chunk = null
    const b64 = results[0]?.result
    if (b64 && b64 !== 'null') {
        const binaryStr = atob(b64)
        const len = binaryStr.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i)
        }
        chunk = bytes.buffer
    }

    // Parse state
    let state = null
    const stateRaw = results[1]?.result
    if (stateRaw && stateRaw !== 'null') {
        try { state = JSON.parse(stateRaw) } catch { state = null }
    }

    return { chunk, state }
}
