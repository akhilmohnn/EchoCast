import QRCode from 'qrcode'

const REDIS_URL = import.meta.env.VITE_REDIS_REST_URL
const REDIS_TOKEN = import.meta.env.VITE_REDIS_REST_TOKEN
const ROOM_TTL_SECONDS = 1500 // 25 minutes
const ROOM_KEY_PREFIX = 'room:'
const PARTICIPANTS_KEY_PREFIX = 'room:participants:'
const AUDIO_STATE_KEY_PREFIX = 'room:audio:'
const AUDIO_DATA_KEY_PREFIX = 'room:audio:data:'
const CHUNK_SIZE = 500 * 1024 // 500KB

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

function getParticipantsKey(roomId) {
  return encodeURIComponent(`${PARTICIPANTS_KEY_PREFIX}${roomId}`)
}

function getAudioStateKey(roomId) {
  return encodeURIComponent(`${AUDIO_STATE_KEY_PREFIX}${roomId}`)
}

function getAudioDataKey(roomId) {
  return encodeURIComponent(`${AUDIO_DATA_KEY_PREFIX}${roomId}`)
}

async function persistRoom(roomId, roomCode, creatorId) {
  ensureRedisConfig()
  const payload = encodeURIComponent(
    JSON.stringify({ roomId, roomCode, creatorId, createdAt: Date.now() })
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

async function addParticipant(roomId, user) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const key = getParticipantsKey(roomId)
  const payload = encodeURIComponent(JSON.stringify(user))
  const url = `${baseUrl}/rpush/${key}/${payload}`

  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })
}

export async function removeParticipant(roomId, user) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const key = getParticipantsKey(roomId)
  const payload = encodeURIComponent(JSON.stringify(user))
  // Count 0 means remove all occurrences of this value
  const url = `${baseUrl}/lrem/${key}/0/${payload}`

  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })
}

export async function getParticipants(roomId) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const url = `${baseUrl}/lrange/${getParticipantsKey(roomId)}/0/-1`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })

  // if (!response.ok) return []
  if (!response.ok) {
    throw new Error(`Failed to fetch participants: ${response.status}`)
  }

  const json = await response.json()
  const rawList = json?.result || []

  // Parse JSON strings back to objects
  return rawList.map(item => {
    try {
      return JSON.parse(item)
    } catch (e) {
      return { id: 'unknown', name: item } // Fallback for old string-only data
    }
  })
}

export async function createRoom(userName) {
  const roomId = generateRoomId()
  const roomCode = generateRoomCode()
  const creatorId = getClientId()

  await persistRoom(roomId, roomCode, creatorId)

  const user = { id: creatorId, name: userName || 'Admin' }
  await addParticipant(roomId, user)

  const joinUrl = `${window.location.origin}/join?room=${roomId}&code=${roomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return { roomId, roomCode, joinUrl, qrDataUrl, creatorId, isCreator: true }
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

export async function joinRoom(roomId, roomCode, userName) {
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

  const userId = getClientId()
  const user = { id: userId, name: userName || `User-${userId.slice(-4)}` }

  // Check if already in participants to avoid duplicates (optional, but good)
  // For now just add, the UI dedupes. Can improve later.
  await addParticipant(normalizedRoomId, user)

  const joinUrl = `${window.location.origin}/join?room=${normalizedRoomId}&code=${normalizedRoomCode}`
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1 })

  return {
    roomId: normalizedRoomId,
    roomCode: normalizedRoomCode,
    joinUrl,
    qrDataUrl,
    creatorId: record.creatorId,
    isCreator: record.creatorId === userId
  }
}

export async function updateAudioState(roomId, state) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const key = getAudioStateKey(roomId)
  const payload = encodeURIComponent(JSON.stringify(state))

  // Set audio state with same expiry as room (roughly)
  const url = `${baseUrl}/setex/${key}/${ROOM_TTL_SECONDS}/${payload}`

  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })
}

export async function getAudioState(roomId) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const key = getAudioStateKey(roomId)
  const url = `${baseUrl}/get/${key}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  })

  if (!response.ok) return null

  const json = await response.json()
  const raw = json?.result
  if (!raw || raw === 'null') return null

  try {
    return JSON.parse(decodeURIComponent(raw))
  } catch (err) {
    console.error('Failed to parse audio state', err)
    return null
  }
}

export async function uploadAudioChunked(roomId, fileDataUrl) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const keyBase = getAudioDataKey(roomId)

  // Calculate chunks
  const totalLength = fileDataUrl.length
  const totalChunks = Math.ceil(totalLength / CHUNK_SIZE)

  // Upload chunks in parallel
  const promises = []
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, totalLength)
    const chunk = fileDataUrl.substring(start, end)

    const key = `${keyBase}:${i}`
    const payload = encodeURIComponent(chunk)
    // Use SETEX to expire same as room
    const url = `${baseUrl}/setex/${key}/${ROOM_TTL_SECONDS}/${payload}`

    promises.push(fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }))
  }

  await Promise.all(promises)

  // Store meta about data so we know how many chunks to fetch
  const metaKey = `${keyBase}:meta`
  const metaPayload = encodeURIComponent(JSON.stringify({ totalChunks, totalLength }))
  await fetch(`${baseUrl}/setex/${metaKey}/${ROOM_TTL_SECONDS}/${metaPayload}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
}

export async function downloadAudioChunked(roomId) {
  ensureRedisConfig()
  const baseUrl = getRedisBaseUrl()
  const keyBase = getAudioDataKey(roomId)

  // Get Meta
  const metaKey = `${keyBase}:meta`
  const metaRes = await fetch(`${baseUrl}/get/${metaKey}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  })
  if (!metaRes.ok) return null
  const metaJson = await metaRes.json()
  if (!metaJson.result) return null

  let meta
  try {
    meta = JSON.parse(decodeURIComponent(metaJson.result))
  } catch (e) {
    return null
  }

  const { totalChunks } = meta

  // Fetch all chunks
  const promises = []
  for (let i = 0; i < totalChunks; i++) {
    const key = `${keyBase}:${i}`
    promises.push(fetch(`${baseUrl}/get/${key}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    }).then(r => r.json()))
  }

  const results = await Promise.all(promises)

  // Reassemble
  let fullDataUrl = ''
  for (const res of results) {
    if (res.result) {
      fullDataUrl += decodeURIComponent(res.result)
    }
  }

  return fullDataUrl
}
