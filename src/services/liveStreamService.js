/**
 * liveStreamService.js
 * -------------------------------------------------------------------
 * Real-time live audio streaming via Redis (Upstash REST).
 *
 * Key difference from previous attempt:
 *   - Uses Upstash POST-body API (not URL-path) so large payloads work
 *   - Each chunk is a COMPLETE, independently-playable audio file
 *   - Slave just creates Audio elements from downloaded blobs
 * -------------------------------------------------------------------
 */

const REDIS_URL = import.meta.env.VITE_REDIS_REST_URL
const REDIS_TOKEN = import.meta.env.VITE_REDIS_REST_TOKEN

const LIVE_STATE_PREFIX = 'room:live:'
const LIVE_CHUNK_PREFIX = 'room:chunk:'
const CHUNK_TTL = 60      // keep chunks for 60s
const STATE_TTL = 900

function baseUrl() { return (REDIS_URL || '').replace(/\/$/, '') }

/**
 * Run an arbitrary Upstash REST command using the POST-body JSON API.
 * This avoids URL length limits for large values.
 * Docs: https://docs.upstash.com/redis/features/restapi#post-body
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
    await runCommand(['SETEX', key, CHUNK_TTL, b64])
}

/**
 * Download a chunk. Returns a data URL string (audio/webm;base64,...) or null.
 */
export async function downloadLiveChunk(roomId, seq, mimeType = 'audio/webm') {
    const key = `${LIVE_CHUNK_PREFIX}${roomId}:${seq}`
    const json = await runCommand(['GET', key])
    const b64 = json?.result
    if (!b64) return null
    // Return a data URI that can be assigned directly to audio.src
    return `data:${mimeType};base64,${b64}`
}
