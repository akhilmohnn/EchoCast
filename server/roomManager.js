/**
 * roomManager.js
 * -------------------------------------------------------------------
 * In-memory room storage for EchoCast signaling server.
 * Replaces the old Redis/Upstash room persistence.
 *
 * Each room has:
 *   - roomId (UUID)
 *   - roomCode (6-digit string)
 *   - creatorId
 *   - participants: Map<userId, { id, name, role }>
 *   - createdAt
 *   - lastActivity (for auto-cleanup)
 * -------------------------------------------------------------------
 */

import { v4 as uuidv4 } from 'uuid'

/** @type {Map<string, RoomData>} */
const rooms = new Map()

/** @type {Map<string, string>}  roomCode → roomId lookup */
const codeIndex = new Map()

const ROOM_TTL_MS = 25 * 60 * 1000 // 25 minutes

// ── Helpers ─────────────────────────────────────────────────────────

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString()
}

function touchRoom(room) {
    room.lastActivity = Date.now()
}

// ── Cleanup expired rooms periodically ──────────────────────────────

setInterval(() => {
    const now = Date.now()
    for (const [roomId, room] of rooms) {
        if (now - room.lastActivity > ROOM_TTL_MS) {
            codeIndex.delete(room.roomCode)
            rooms.delete(roomId)
            console.log(`[RoomManager] Expired room ${roomId}`)
        }
    }
}, 60_000) // check every minute

// ── Public API ──────────────────────────────────────────────────────

export function createRoom(creatorId, creatorName) {
    const roomId = uuidv4()
    let roomCode = generateRoomCode()

    // Ensure code uniqueness (extremely unlikely collision, but safe)
    while (codeIndex.has(roomCode)) {
        roomCode = generateRoomCode()
    }

    const room = {
        roomId,
        roomCode,
        creatorId,
        participants: new Map(),
        createdAt: Date.now(),
        lastActivity: Date.now(),
    }

    // Add creator as first participant
    room.participants.set(creatorId, {
        id: creatorId,
        name: creatorName || 'Admin',
        role: 'creator',
    })

    rooms.set(roomId, room)
    codeIndex.set(roomCode, roomId)

    console.log(`[RoomManager] Created room ${roomId} (code: ${roomCode})`)
    return { roomId, roomCode, creatorId }
}

export function joinRoom(roomId, roomCode, userId, userName) {
    const room = rooms.get(roomId)
    if (!room) {
        throw new Error('Room not found or expired.')
    }

    if (String(room.roomCode) !== String(roomCode).trim()) {
        throw new Error('Invalid room code.')
    }

    // Add participant (or update name if re-joining)
    room.participants.set(userId, {
        id: userId,
        name: userName || `User-${userId.slice(-4)}`,
        role: room.creatorId === userId ? 'creator' : 'listener',
    })

    touchRoom(room)

    return {
        roomId: room.roomId,
        roomCode: room.roomCode,
        creatorId: room.creatorId,
        isCreator: room.creatorId === userId,
    }
}

export function removeParticipant(roomId, userId) {
    const room = rooms.get(roomId)
    if (!room) return false

    room.participants.delete(userId)
    touchRoom(room)

    // If room is empty, remove it
    if (room.participants.size === 0) {
        codeIndex.delete(room.roomCode)
        rooms.delete(roomId)
        console.log(`[RoomManager] Room ${roomId} empty — deleted`)
    }

    return true
}

export function getParticipants(roomId) {
    const room = rooms.get(roomId)
    if (!room) return []
    return Array.from(room.participants.values())
}

export function getRoom(roomId) {
    return rooms.get(roomId) || null
}

export function roomExists(roomId) {
    return rooms.has(roomId)
}
