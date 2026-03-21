/**
 * roomService.js
 * -------------------------------------------------------------------
 * Room management via WebSocket signaling server.
 * Replaces the old Redis/Upstash HTTP API.
 *
 * The signaling server handles:
 *   - Room creation / joining / leaving
 *   - Participant tracking (real-time via WS)
 *   - LiveKit token generation
 *
 * This module manages a persistent WebSocket connection and exposes
 * a Promise-based API to the rest of the app.
 * -------------------------------------------------------------------
 */

import QRCode from 'qrcode'

// Build the signaling WebSocket URL dynamically from the current page location
// This ensures it goes through Vite's proxy (same origin) and avoids mixed content
function getSignalingUrl() {
  // If a full URL is provided (e.g., for production), use it directly
  const envUrl = import.meta.env.VITE_SIGNALING_URL
  if (envUrl && (envUrl.startsWith('ws://') || envUrl.startsWith('wss://'))) {
    return envUrl
  }
  // Otherwise, build from current page location + path
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const path = import.meta.env.VITE_SIGNALING_PATH || '/ws'
  return `${proto}//${window.location.host}${path}`
}

// ── Client ID (persisted per session) ───────────────────────────────

function getClientId() {
  const key = 'echocast_client_id'
  let id = sessionStorage.getItem(key)
  if (!id) {
    id = `User-${Math.floor(Math.random() * 10000)}`
    sessionStorage.setItem(key, id)
  }
  return id
}

export function getCurrentUserId() {
  return getClientId()
}

// ── WebSocket Connection ────────────────────────────────────────────

let ws = null
let wsReady = false
const pendingRequests = new Map()  // type → { resolve, reject, timeout }
const eventListeners = new Map()   // eventType → Set<callback>
let reconnectTimer = null
let currentRoomId = null

/**
 * Ensure the WebSocket is connected.
 * Returns a promise that resolves when the connection is open.
 */
function ensureConnection() {
  return new Promise((resolve, reject) => {
    if (ws && wsReady) {
      resolve()
      return
    }

    // Clean up existing connection
    if (ws) {
      try { ws.close() } catch { /* ignore */ }
    }

    const signalingUrl = getSignalingUrl()
    ws = new WebSocket(signalingUrl)

    ws.onopen = () => {
      wsReady = true
      console.log('[Signaling] Connected to', signalingUrl)
      resolve()
    }

    ws.onerror = (err) => {
      console.error('[Signaling] WebSocket error:', err)
      wsReady = false
      reject(new Error('Could not connect to signaling server'))
    }

    ws.onclose = () => {
      wsReady = false
      console.log('[Signaling] Disconnected')

      // Auto-reconnect after 3 seconds if we were in a room
      if (currentRoomId && !reconnectTimer) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          ensureConnection().catch(() => { })
        }, 3000)
      }
    }

    ws.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }

      // Handle error responses from the server — match to pending request
      if (msg.type === 'error' && msg.requestType) {
        // Server errors include requestType (e.g., 'create_room', 'join_room')
        // Map server action types to expected response types
        const requestToResponse = {
          'create_room': 'room_created',
          'join_room': 'room_joined',
          'get_participants': 'participants_list',
        }
        const expectedResponse = requestToResponse[msg.requestType]
        if (expectedResponse && pendingRequests.has(expectedResponse)) {
          const { reject: rej, timeout } = pendingRequests.get(expectedResponse)
          clearTimeout(timeout)
          pendingRequests.delete(expectedResponse)
          rej(new Error(msg.error || 'Server error'))
          return
        }
      }

      // Check if there's a pending request for this message type
      const responseType = msg.type
      if (pendingRequests.has(responseType)) {
        const { resolve: res, timeout } = pendingRequests.get(responseType)
        clearTimeout(timeout)
        pendingRequests.delete(responseType)
        res(msg)
        return
      }

      // Otherwise, dispatch to event listeners
      const listeners = eventListeners.get(responseType)
      if (listeners) {
        for (const cb of listeners) {
          try { cb(msg) } catch (err) {
            console.error('[Signaling] Event handler error:', err)
          }
        }
      }
    }
  })
}

/**
 * Send a message and wait for a specific response type.
 */
async function sendAndWait(msg, responseType, timeoutMs = 10000) {
  await ensureConnection()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(responseType)
      reject(new Error(`Signaling timeout waiting for ${responseType}`))
    }, timeoutMs)

    pendingRequests.set(responseType, { resolve, reject, timeout })
    ws.send(JSON.stringify(msg))
  })
}

/**
 * Send a message without waiting for a response.
 */
async function sendMessage(msg) {
  await ensureConnection()
  ws.send(JSON.stringify(msg))
}

// ── Event Subscription ──────────────────────────────────────────────

/**
 * Subscribe to signaling server events.
 * @param {string} eventType - Message type to listen for
 * @param {Function} callback - Handler function
 * @returns {Function} Unsubscribe function
 */
export function onSignalingEvent(eventType, callback) {
  if (!eventListeners.has(eventType)) {
    eventListeners.set(eventType, new Set())
  }
  eventListeners.get(eventType).add(callback)

  return () => {
    const set = eventListeners.get(eventType)
    if (set) set.delete(callback)
  }
}

// ── Room API ────────────────────────────────────────────────────────

/**
 * Create a new room.
 * @param {string} [userName] - Creator's display name
 * @returns {Promise<Object>} Room info with LiveKit token
 */
export async function createRoom(userName) {
  const userId = getClientId()

  const response = await sendAndWait(
    { type: 'create_room', userId, userName: userName || 'Admin' },
    'room_created'
  )

  if (response.error) throw new Error(response.error)

  currentRoomId = response.roomId

  // Generate QR code and join URL
  const joinUrl = `${window.location.origin}/join?room=${response.roomId}&code=${response.roomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return {
    roomId: response.roomId,
    roomCode: response.roomCode,
    creatorId: response.creatorId,
    isCreator: true,
    joinUrl,
    qrDataUrl,
    livekitToken: response.livekitToken,
    livekitUrl: response.livekitUrl,
  }
}

/**
 * Join an existing room.
 * @param {string} roomId
 * @param {string} roomCode
 * @param {string} [userName]
 * @returns {Promise<Object>} Room info with LiveKit token
 */
export async function joinRoom(roomId, roomCode, userName) {
  const userId = getClientId()
  const normalizedRoomId = roomId?.trim()
  const normalizedRoomCode = String(roomCode || '').trim()

  if (!normalizedRoomId || !normalizedRoomCode) {
    throw new Error('Room ID and code are required.')
  }

  const response = await sendAndWait(
    {
      type: 'join_room',
      roomId: normalizedRoomId,
      roomCode: normalizedRoomCode,
      userId,
      userName: userName || `User-${userId.slice(-4)}`,
    },
    'room_joined'
  )

  if (response.error) throw new Error(response.error)

  currentRoomId = normalizedRoomId

  // Generate QR code and join URL
  const joinUrl = `${window.location.origin}/join?room=${normalizedRoomId}&code=${normalizedRoomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return {
    roomId: response.roomId,
    roomCode: response.roomCode,
    creatorId: response.creatorId,
    isCreator: response.isCreator,
    joinUrl,
    qrDataUrl,
    livekitToken: response.livekitToken,
    livekitUrl: response.livekitUrl,
  }
}

/**
 * Leave the current room.
 */
export async function leaveRoom(roomId, userId) {
  currentRoomId = null
  try {
    await sendMessage({ type: 'leave_room', roomId, userId })
  } catch {
    // Best-effort — connection may already be closed
  }
}

/**
 * Remove a participant from a room (creator only).
 */
export async function removeParticipant(roomId, user) {
  await sendMessage({
    type: 'remove_participant',
    roomId,
    targetUserId: typeof user === 'string' ? user : user.id,
  })
}

/**
 * Mute or unmute a participant (creator only).
 */
export async function toggleParticipantMute(roomId, targetUserId, mute) {
  await sendMessage({
    type: 'toggle_participant_mute',
    roomId,
    targetUserId,
    mute
  })
}

/**
 * Update volumes for multiple users spatially (creator only).
 */
export async function updateSpatialVolumes(roomId, volumes) {
  sendMessage({ // Fire and forget (don't wait for response to reduce latency)
    type: 'update_spatial_volumes',
    roomId,
    volumes
  })
}

/**
 * Request the current participant list.
 */
export async function getParticipants(roomId) {
  const response = await sendAndWait(
    { type: 'get_participants', roomId },
    'participants_list'
  )
  return response.participants || []
}

/**
 * Disconnect the signaling WebSocket entirely.
 */
export function disconnectSignaling() {
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  currentRoomId = null
  if (ws) {
    try { ws.close() } catch { /* ignore */ }
    ws = null
    wsReady = false
  }
}
