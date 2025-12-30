import QRCode from 'qrcode'

const REDIS_URL = import.meta.env.VITE_REDIS_REST_URL
const REDIS_TOKEN = import.meta.env.VITE_REDIS_REST_TOKEN
const ROOM_TTL_SECONDS = 900 // 15 minutes

function generateRoomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `room-${Math.random().toString(36).slice(2, 10)}`
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

async function persistRoom(roomId, roomCode) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Missing Redis configuration. Set VITE_REDIS_REST_URL and VITE_REDIS_REST_TOKEN.')
  }

  const payload = encodeURIComponent(
    JSON.stringify({ roomId, roomCode, createdAt: Date.now() })
  )
  const baseUrl = REDIS_URL.replace(/\/$/, '')
  const url = `${baseUrl}/setex/room:${roomId}/${ROOM_TTL_SECONDS}/${payload}`

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
