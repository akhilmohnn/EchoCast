/**
 * useLivekitListener.js
 * -------------------------------------------------------------------
 * Listener-side hook: connects to the LiveKit room as a subscriber
 * and plays back the creator's audio track via an HTMLAudioElement.
 *
 * Replaces the old useLiveAudioPlayer (polling-based Web Audio API).
 *
 * WebRTC flow:
 *   SFU → TrackSubscribed event → attach to <audio> → native playback
 *
 * Benefits over old approach:
 *   - No polling (event-driven)
 *   - No base64 encoding/decoding
 *   - No MediaRecorder chunking
 *   - Sub-100ms latency (vs ~400ms+ before)
 *   - Opus codec (efficient, built into WebRTC)
 * -------------------------------------------------------------------
 */

import { useEffect, useRef, useCallback } from 'react'
import { connectToRoom, disconnectRoom, RoomEvent, Track } from '../webrtc/livekitClient'

/**
 * @param {string|null} livekitUrl   - LiveKit server URL (null = don't connect)
 * @param {string|null} livekitToken - Access token (null = don't connect)
 * @param {boolean} enabled          - Whether audio should play (mute/unmute)
 * @param {number} volume            - Audio volume from 0.0 to 1.0 (default 1.0)
 */
export function useLivekitListener(livekitUrl, livekitToken, enabled, volume = 1.0) {
    const roomRef = useRef(null)
    const audioElementsRef = useRef(new Map()) // trackSid → HTMLAudioElement
    const enabledRef = useRef(enabled)
    const volumeRef = useRef(volume)

    // Keep volume in sync
    useEffect(() => {
        volumeRef.current = volume
        for (const audio of audioElementsRef.current.values()) {
            audio.volume = volume
        }
    }, [volume])

    // Keep enabled ref in sync for use in callbacks
    useEffect(() => {
        enabledRef.current = enabled

        // Update volume on all active audio elements
        for (const audio of audioElementsRef.current.values()) {
            audio.muted = !enabled
        }
    }, [enabled])

    // Attach a remote audio track to an HTMLAudioElement for playback
    const attachTrack = useCallback((track, publication) => {
        const audioEl = track.attach()
        audioEl.muted = !enabledRef.current
        audioEl.volume = volumeRef.current
        audioEl.autoplay = true

        // Append to DOM (hidden) — needed for autoplay policies
        audioEl.style.display = 'none'
        document.body.appendChild(audioEl)

        audioElementsRef.current.set(publication.trackSid, audioEl)
        console.log('[Listener] Attached audio track:', publication.trackSid)
    }, [])

    // Detach a remote audio track
    const detachTrack = useCallback((track, publication) => {
        const audioEl = audioElementsRef.current.get(publication.trackSid)
        if (audioEl) {
            audioEl.pause()
            audioEl.srcObject = null
            audioEl.remove()
            audioElementsRef.current.delete(publication.trackSid)
        }
        track.detach()
        console.log('[Listener] Detached audio track:', publication.trackSid)
    }, [])

    // Clean up all audio elements
    const cleanupAllAudio = useCallback(() => {
        for (const [sid, audioEl] of audioElementsRef.current) {
            audioEl.pause()
            audioEl.srcObject = null
            audioEl.remove()
        }
        audioElementsRef.current.clear()
    }, [])

    // Main connection effect
    useEffect(() => {
        if (!livekitUrl || !livekitToken) return

        let cancelled = false

        async function connect() {
            try {
                const room = await connectToRoom(livekitUrl, livekitToken)
                if (cancelled) {
                    await disconnectRoom(room)
                    return
                }

                roomRef.current = room

                // Handle tracks that are already publishing when we join
                for (const participant of room.remoteParticipants.values()) {
                    for (const publication of participant.trackPublications.values()) {
                        if (
                            publication.track &&
                            publication.kind === Track.Kind.Audio &&
                            publication.isSubscribed
                        ) {
                            attachTrack(publication.track, publication)
                        }
                    }
                }

                // Listen for new tracks being subscribed
                room.on(RoomEvent.TrackSubscribed, (track, publication) => {
                    if (track.kind === Track.Kind.Audio) {
                        attachTrack(track, publication)
                    }
                })

                // Listen for tracks being unsubscribed
                room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
                    if (track.kind === Track.Kind.Audio) {
                        detachTrack(track, publication)
                    }
                })

                // Handle reconnection
                room.on(RoomEvent.Reconnecting, () => {
                    console.log('[Listener] Reconnecting to LiveKit...')
                })

                room.on(RoomEvent.Reconnected, () => {
                    console.log('[Listener] Reconnected to LiveKit')
                })

                room.on(RoomEvent.Disconnected, () => {
                    console.log('[Listener] Disconnected from LiveKit')
                    cleanupAllAudio()
                })

            } catch (err) {
                console.error('[Listener] Failed to connect to LiveKit:', err)
            }
        }

        connect()

        return () => {
            cancelled = true
            cleanupAllAudio()
            if (roomRef.current) {
                disconnectRoom(roomRef.current)
                roomRef.current = null
            }
        }
    }, [livekitUrl, livekitToken, attachTrack, detachTrack, cleanupAllAudio])
}
