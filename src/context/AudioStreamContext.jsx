/**
 * AudioStreamContext.jsx
 * -------------------------------------------------------------------
 * Manages live audio streaming state for the creator/master.
 *
 * New architecture (WebRTC + LiveKit):
 *   1. captureTabAudio() → MediaStream
 *   2. connectToRoom()   → LiveKit Room (SFU)
 *   3. publishAudioTrack() → audio sent to all listeners via SFU
 *
 * Replaced:
 *   - MediaRecorder blob pipeline
 *   - Redis/Upstash chunk uploads
 *   - Base64 encoding
 *   - BroadcastChannel popup sync
 * -------------------------------------------------------------------
 */

import { createContext, useContext, useState, useRef, useCallback } from 'react'
import { captureTabAudio } from '../webrtc/media'
import { connectToRoom, publishAudioTrack, disconnectRoom } from '../webrtc/livekitClient'

const AudioStreamContext = createContext(null)

export function AudioStreamProvider({ children }) {
    const [isStreaming, setIsStreaming] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [permissionError, setPermissionError] = useState(null)

    // Refs for mutable state that doesn't need re-renders
    const streamRef = useRef(null)       // MediaStream from getDisplayMedia
    const livekitRoomRef = useRef(null)  // LiveKit Room instance
    const localTrackRef = useRef(null)   // Published LocalAudioTrack
    const timerRef = useRef(null)
    const elapsedRef = useRef(0)
    const streamingRef = useRef(false)

    // ── Timer ──────────────────────────────────────────────────────────

    const startTimer = useCallback(() => {
        clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
            elapsedRef.current += 1
            setElapsed(elapsedRef.current)
        }, 1000)
    }, [])

    const stopTimer = useCallback(() => {
        clearInterval(timerRef.current)
        timerRef.current = null
        elapsedRef.current = 0
        setElapsed(0)
    }, [])

    // ── Start Streaming ────────────────────────────────────────────────
    // Flow: capture tab audio → connect to LiveKit → publish track

    const startStream = useCallback(async (roomId, livekitUrl, livekitToken) => {
        setPermissionError(null)

        // Step 1: Capture tab audio
        let mediaStream
        try {
            mediaStream = await captureTabAudio()
        } catch (err) {
            console.error('[AudioStream] Capture error:', err)
            if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
                return { ok: false, error: null } // user cancelled — no error to show
            }
            const msg = err.message || 'Could not capture browser audio.'
            setPermissionError(msg)
            return { ok: false, error: msg }
        }

        // Auto-stop when browser's "Stop sharing" bar is clicked
        mediaStream.getAudioTracks().forEach(t => {
            t.addEventListener('ended', () => stopStream())
        })
        streamRef.current = mediaStream

        // Step 2: Connect to LiveKit room and publish
        try {
            const room = await connectToRoom(livekitUrl, livekitToken)
            livekitRoomRef.current = room

            const localTrack = await publishAudioTrack(room, mediaStream)
            localTrackRef.current = localTrack

            // Update state
            streamingRef.current = true
            setIsStreaming(true)
            setIsPaused(false)
            startTimer()

            return { ok: true, error: null }
        } catch (err) {
            console.error('[AudioStream] LiveKit error:', err)
            const msg = `LiveKit connection failed: ${err.message || 'unknown error'}. Check your LiveKit credentials.`
            setPermissionError(msg)

            // Clean up
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(t => t.stop())
                streamRef.current = null
            }
            if (livekitRoomRef.current) {
                await disconnectRoom(livekitRoomRef.current)
                livekitRoomRef.current = null
            }

            return { ok: false, error: msg }
        }
    }, [startTimer])

    // ── Pause Stream ───────────────────────────────────────────────────
    // Mutes the published audio track (listeners hear silence)

    const pauseStream = useCallback(() => {
        if (!streamRef.current) return

        // Mute the audio track (stops sending audio data)
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = false })

        // Also mute in LiveKit
        if (localTrackRef.current) {
            localTrackRef.current.mute()
        }

        setIsPaused(true)
        clearInterval(timerRef.current)
    }, [])

    // ── Resume Stream ──────────────────────────────────────────────────

    const resumeStream = useCallback(() => {
        if (!streamRef.current) return

        // Unmute the audio track
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = true })

        // Unmute in LiveKit
        if (localTrackRef.current) {
            localTrackRef.current.unmute()
        }

        setIsPaused(false)
        startTimer()
    }, [startTimer])

    // ── Stop Stream ────────────────────────────────────────────────────
    // Full cleanup: unpublish track, disconnect LiveKit, stop MediaStream

    const stopStream = useCallback(async () => {
        // Stop and clean up local track
        localTrackRef.current = null

        // Disconnect from LiveKit room
        if (livekitRoomRef.current) {
            await disconnectRoom(livekitRoomRef.current)
            livekitRoomRef.current = null
        }

        // Stop the MediaStream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop())
            streamRef.current = null
        }

        // Reset state
        streamingRef.current = false
        setIsStreaming(false)
        setIsPaused(false)
        stopTimer()
    }, [stopTimer])

    return (
        <AudioStreamContext.Provider value={{
            isStreaming,
            isPaused,
            elapsed,
            permissionError,
            startStream,
            pauseStream,
            resumeStream,
            stopStream,
        }}>
            {children}
        </AudioStreamContext.Provider>
    )
}

export function useAudioStream() {
    const ctx = useContext(AudioStreamContext)
    if (!ctx) throw new Error('useAudioStream must be used within AudioStreamProvider')
    return ctx
}
