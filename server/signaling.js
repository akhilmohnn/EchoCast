/**
 * signaling.js
 * -------------------------------------------------------------------
 * EchoCast WebSocket signaling server.
 *
 * Responsibilities:
 *   1. Room creation / joining (delegates to roomManager)
 *   2. LiveKit access token generation (publish for creator, subscribe for listeners)
 *   3. Real-time participant updates via WebSocket broadcast
 *
 * NO media passes through this server — only signaling messages.
 * -------------------------------------------------------------------
 */

import 'dotenv/config'
import http from 'node:http'
import { WebSocketServer } from 'ws'
import { AccessToken } from 'livekit-server-sdk'
import {
    createRoom,
    joinRoom,
    removeParticipant,
    getParticipants,
    getRoom,
} from './roomManager.js'

const PORT = process.env.PORT || 3001
const LK_API_KEY = process.env.LIVEKIT_API_KEY
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET
const LK_URL = process.env.LIVEKIT_URL

if (!LK_API_KEY || !LK_API_SECRET) {
    console.warn('⚠️  LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set — token generation will fail.')
}

// ── HTTP Server (health-check for Render / Railway / etc.) ──────────

const httpServer = http.createServer((req, res) => {
    // CORS preflight for browsers that probe the origin
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        return res.end()
    }

    // Health-check endpoint
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'echocast-signaling' }))
})

// ── WebSocket Server (attached to the HTTP server) ──────────────────

const wss = new WebSocketServer({ server: httpServer })

/** @type {Map<WebSocket, { userId: string, roomId: string | null }>} */
const clients = new Map()

/** @type {Map<string, Set<WebSocket>>}  roomId → connected sockets */
const roomSockets = new Map()

httpServer.listen(PORT, () => {
    console.log(`✅ EchoCast signaling server running on port ${PORT}`)
})

wss.on('connection', (ws) => {
    clients.set(ws, { userId: null, roomId: null })

    ws.on('message', async (raw) => {
        let msg
        try {
            msg = JSON.parse(raw)
        } catch {
            return send(ws, { type: 'error', error: 'Invalid JSON' })
        }

        try {
            await handleMessage(ws, msg)
        } catch (err) {
            send(ws, { type: 'error', requestType: msg.type, error: err.message })
        }
    })

    ws.on('close', () => {
        handleDisconnect(ws)
    })
})

// ── Send helper ─────────────────────────────────────────────────────

function send(ws, data) {
    if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data))
    }
}

function broadcastToRoom(roomId, data, excludeWs = null) {
    const sockets = roomSockets.get(roomId)
    if (!sockets) return
    for (const ws of sockets) {
        if (ws !== excludeWs) send(ws, data)
    }
}

// ── LiveKit Token Generation ────────────────────────────────────────

async function generateLivekitToken(roomId, userId, isCreator) {
    const token = new AccessToken(LK_API_KEY, LK_API_SECRET, {
        identity: userId,
        ttl: '25m',
    })

    token.addGrant({
        room: roomId,
        roomJoin: true,
        canPublish: isCreator,       // only creator can publish audio
        canSubscribe: !isCreator,    // listeners subscribe
        canPublishData: true,        // allow data messages (for future features)
    })

    return await token.toJwt()
}

// ── Add socket to room tracking ─────────────────────────────────────

function trackSocket(ws, roomId, userId) {
    const meta = clients.get(ws)
    if (meta) {
        meta.userId = userId
        meta.roomId = roomId
    }

    if (!roomSockets.has(roomId)) {
        roomSockets.set(roomId, new Set())
    }
    roomSockets.get(roomId).add(ws)
}

function untrackSocket(ws) {
    const meta = clients.get(ws)
    if (!meta || !meta.roomId) return null

    const { roomId, userId } = meta
    const sockets = roomSockets.get(roomId)
    if (sockets) {
        sockets.delete(ws)
        if (sockets.size === 0) roomSockets.delete(roomId)
    }

    clients.delete(ws)
    return { roomId, userId }
}

// ── Message Handler ─────────────────────────────────────────────────

async function handleMessage(ws, msg) {
    switch (msg.type) {
        // ── Create Room ──────────────────────────────────────────────────
        case 'create_room': {
            const { userId, userName } = msg
            if (!userId) throw new Error('userId is required')

            const room = createRoom(userId, userName)
            trackSocket(ws, room.roomId, userId)

            // Generate LiveKit token for creator (can publish)
            const token = await generateLivekitToken(room.roomId, userId, true)

            send(ws, {
                type: 'room_created',
                roomId: room.roomId,
                roomCode: room.roomCode,
                creatorId: room.creatorId,
                isCreator: true,
                livekitToken: token,
                livekitUrl: LK_URL,
                participants: getParticipants(room.roomId),
            })
            break
        }

        // ── Join Room ────────────────────────────────────────────────────
        case 'join_room': {
            const { roomId, roomCode, userId, userName } = msg
            if (!roomId || !roomCode || !userId) {
                throw new Error('roomId, roomCode, and userId are required')
            }

            const result = joinRoom(roomId, roomCode, userId, userName)
            trackSocket(ws, roomId, userId)

            // Generate LiveKit token (subscribe-only for listeners, publish for creator)
            const token = await generateLivekitToken(roomId, userId, result.isCreator)

            send(ws, {
                type: 'room_joined',
                ...result,
                livekitToken: token,
                livekitUrl: LK_URL,
                participants: getParticipants(roomId),
            })

            // Notify others in the room
            broadcastToRoom(roomId, {
                type: 'participant_joined',
                participants: getParticipants(roomId),
            }, ws)
            break
        }

        // ── Leave Room ───────────────────────────────────────────────────
        case 'leave_room': {
            const { roomId, userId } = msg
            if (roomId && userId) {
                removeParticipant(roomId, userId)
                broadcastToRoom(roomId, {
                    type: 'participant_left',
                    userId,
                    participants: getParticipants(roomId),
                }, ws)
            }
            untrackSocket(ws)
            send(ws, { type: 'left_room' })
            break
        }

        // ── Remove Participant (creator only) ────────────────────────────
        case 'remove_participant': {
            const { roomId, targetUserId } = msg
            const meta = clients.get(ws)
            const room = getRoom(roomId)

            if (!room || !meta || room.creatorId !== meta.userId) {
                throw new Error('Only the room creator can remove participants')
            }

            removeParticipant(roomId, targetUserId)

            // Notify the removed user
            const sockets = roomSockets.get(roomId)
            if (sockets) {
                for (const s of sockets) {
                    const sMeta = clients.get(s)
                    if (sMeta?.userId === targetUserId) {
                        send(s, { type: 'you_were_removed' })
                    }
                }
            }

            // Broadcast updated participant list
            broadcastToRoom(roomId, {
                type: 'participant_left',
                userId: targetUserId,
                participants: getParticipants(roomId),
            })
            break
        }

        // ── Toggle Participant Mute (creator only) ───────────────────────
        case 'toggle_participant_mute': {
            const { roomId, targetUserId, mute } = msg
            const meta = clients.get(ws)
            const room = getRoom(roomId)

            if (!room || !meta || room.creatorId !== meta.userId) {
                throw new Error('Only the room creator can mute or unmute participants')
            }

            const sockets = roomSockets.get(roomId)
            if (sockets) {
                for (const s of sockets) {
                    const sMeta = clients.get(s)
                    if (sMeta?.userId === targetUserId) {
                        send(s, { type: 'admin_toggled_mute', mute })
                        break
                    }
                }
            }

            broadcastToRoom(roomId, {
                type: 'participant_mute_toggled',
                userId: targetUserId,
                mute
            })
            break
        }

        // ── Get Participants ─────────────────────────────────────────────
        case 'get_participants': {
            const { roomId } = msg
            send(ws, {
                type: 'participants_list',
                participants: getParticipants(roomId),
            })
            break
        }

        default:
            send(ws, { type: 'error', error: `Unknown message type: ${msg.type}` })
    }
}

// ── Handle Disconnect ───────────────────────────────────────────────

function handleDisconnect(ws) {
    const info = untrackSocket(ws)
    if (info) {
        const { roomId, userId } = info
        removeParticipant(roomId, userId)
        broadcastToRoom(roomId, {
            type: 'participant_left',
            userId,
            participants: getParticipants(roomId),
        })
        console.log(`[Signaling] ${userId} disconnected from room ${roomId}`)
    }
}
