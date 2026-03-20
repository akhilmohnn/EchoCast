/**
 * livekitClient.js
 * -------------------------------------------------------------------
 * Wraps the livekit-client SDK for EchoCast.
 *
 * Provides:
 *   - connectToRoom(url, token)   → connect to LiveKit room
 *   - publishAudioTrack(room, ms) → publish a local audio track
 *   - disconnectRoom(room)        → clean disconnect
 *
 * WebRTC flow:
 *   Master: captureTabAudio() → publishAudioTrack() → SFU distributes
 *   Listener: connectToRoom() → TrackSubscribed event → audio playback
 * -------------------------------------------------------------------
 */

import {
    Room,
    RoomEvent,
    Track,
    LocalAudioTrack,
} from 'livekit-client'

/**
 * Connect to a LiveKit room.
 *
 * @param {string} url    - LiveKit server URL (wss://...)
 * @param {string} token  - Access token from signaling server
 * @returns {Promise<Room>} Connected LiveKit Room instance
 */
export async function connectToRoom(url, token) {
    const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Audio-specific settings for low latency
        audioCaptureDefaults: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        },
    })

    await room.connect(url, token)
    console.log('[LiveKit] Connected to room:', room.name)

    return room
}

/**
 * Publish a local audio track from a MediaStream to the LiveKit room.
 * Used by the master/creator to send tab audio to the SFU.
 *
 * @param {Room} room         - Connected LiveKit Room
 * @param {MediaStream} mediaStream - Audio stream from getDisplayMedia
 * @returns {Promise<LocalAudioTrack>} The published track
 */
export async function publishAudioTrack(room, mediaStream) {
    const audioTrack = mediaStream.getAudioTracks()[0]
    if (!audioTrack) {
        throw new Error('No audio track found in the media stream')
    }

    const localTrack = new LocalAudioTrack(audioTrack, undefined, false)

    await room.localParticipant.publishTrack(localTrack, {
        name: 'echocast-audio',
        // Opus codec is used by default in WebRTC — no extra config needed
    })

    console.log('[LiveKit] Published audio track')
    return localTrack
}

/**
 * Disconnect from a LiveKit room cleanly.
 *
 * @param {Room} room - The LiveKit Room to disconnect from
 */
export async function disconnectRoom(room) {
    if (!room) return
    try {
        await room.disconnect()
        console.log('[LiveKit] Disconnected from room')
    } catch (err) {
        console.warn('[LiveKit] Disconnect error:', err)
    }
}

// Re-export events for convenience
export { Room, RoomEvent, Track }
