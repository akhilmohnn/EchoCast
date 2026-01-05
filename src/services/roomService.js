import QRCode from 'qrcode'

const REDIS_URL = import.meta.env.VITE_REDIS_REST_URL
const REDIS_TOKEN = import.meta.env.VITE_REDIS_REST_TOKEN
const ROOM_TTL_SECONDS = 900 // 15 minutes
const ROOM_KEY_PREFIX = 'room:'

function ensureRedisConfig() {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Missing Redis configuration. Set VITE_REDIS_REST_URL and VITE_REDIS_REST_TOKEN.')
  }
}

function getRedisBaseUrl() {
  ensureRedisConfig()
  return REDIS_URL.replace(/\/$/, '')
}

function generateRoomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `room-${Math.random().toString(36).slice(2, 10)}`
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function getRoomKey(roomId) {
  return encodeURIComponent(`${ROOM_KEY_PREFIX}${roomId}`)
}

async function persistRoom(roomId, roomCode) {
  ensureRedisConfig()
  const payload = encodeURIComponent(
    JSON.stringify({ roomId, roomCode, createdAt: Date.now() })
  )
  const baseUrl = getRedisBaseUrl()
  const url = `${baseUrl}/setex/${getRoomKey(roomId)}/${ROOM_TTL_SECONDS}/${payload}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to persist room to Redis: ${response.status} ${body}`)
  }
}

export async function createRoom() {
  const roomId = generateRoomId()
  const roomCode = generateRoomCode()

  await persistRoom(roomId, roomCode)

  const joinUrl = `${window.location.origin}/join?room=${roomId}&code=${roomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return { roomId, roomCode, joinUrl, qrDataUrl }
}

async function fetchRoom(roomId) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const url = `${baseUrl}/get/${getRoomKey(roomId)}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to fetch room: ${response.status} ${body}`)
  }

  const json = await response.json()
  // Upstash REST API returns { result: <value> }
  const raw = json?.result
  if (!raw || raw === 'null' || raw === null) return null

  // The stored value was URL-encoded JSON; decode and parse.
  try {
    const decoded = decodeURIComponent(raw)
    const parsed = JSON.parse(decoded)
    console.debug('Fetched room record:', parsed)
    return parsed
  } catch (err) {
    console.error('Failed to parse room data:', err, raw)
    throw new Error('Room data corrupted or unreadable.')
  }
}

export async function joinRoom(roomId, roomCode) {
  const normalizedRoomId = roomId?.trim()
  const normalizedRoomCode =
    typeof roomCode === 'string' || typeof roomCode === 'number'
      ? String(roomCode).trim()
      : ''

  if (!normalizedRoomId || !normalizedRoomCode) {
    throw new Error('Room ID and code are required.')
  }

  const record = await fetchRoom(normalizedRoomId)
  if (!record) {
    throw new Error('Room not found or expired.')
  }

  const storedCode = record.roomCode ? String(record.roomCode).trim() : ''
  if (!storedCode || storedCode !== normalizedRoomCode) {
    // Surfacing minimal debug info in console for troubleshooting code mismatches.
    console.debug('Room code mismatch', {
      normalizedRoomId,
      providedCode: normalizedRoomCode,
      storedCode,
    })
    throw new Error('Invalid room code. Double-check the 6-digit code and try again.')
  }

  const joinUrl = `${window.location.origin}/join?room=${normalizedRoomId}&code=${normalizedRoomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return { roomId: normalizedRoomId, roomCode: normalizedRoomCode, joinUrl, qrDataUrl }
}
