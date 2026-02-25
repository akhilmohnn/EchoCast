/**
 * useLiveAudioPlayer.js
 * -------------------------------------------------------------------
 * Slave-side real-time audio player.
 *
 * Every chunk from the master is a COMPLETE, independently-playable
 * audio file (WebM with headers). We simply:
 *   1. Poll getLiveState() every ~2s (with concurrency guard)
 *   2. When seq advances, download the NEW chunk only
 *   3. Queue it for sequential playback via Audio elements
 * -------------------------------------------------------------------
 */

import { useEffect, useRef } from 'react'
import { getLiveState, downloadLiveChunk } from '../services/liveStreamService'

export function useLiveAudioPlayer(roomId, enabled) {
    const lastSeqRef = useRef(-1)
    const pollRef = useRef(null)
    const currentAudio = useRef(null)
    const queueRef = useRef([])
    const enabledRef = useRef(enabled)
    const playingRef = useRef(false)
    const pollingRef = useRef(false)    // ← concurrency guard

    // Keep enabled in sync without restarting polling
    useEffect(() => {
        enabledRef.current = enabled
        if (currentAudio.current) {
            currentAudio.current.muted = !enabled
        }
    }, [enabled])

    // ── Play next in queue (sequential, one at a time) ──────────────
    const playNext = () => {
        if (queueRef.current.length === 0) {
            playingRef.current = false
            return
        }

        playingRef.current = true
        const dataUri = queueRef.current.shift()
        const audio = new Audio(dataUri)
        audio.muted = !enabledRef.current
        currentAudio.current = audio

        audio.addEventListener('ended', () => {
            currentAudio.current = null
            playNext()
        }, { once: true })

        audio.addEventListener('error', () => {
            console.warn('[Live] Audio chunk error, skipping')
            currentAudio.current = null
            playNext()
        }, { once: true })

        audio.play().catch(err => {
            console.warn('[Live] play() blocked:', err.message)
            currentAudio.current = null
            playingRef.current = false
        })
    }

    // ── Main polling loop ─────────────────────────────────────────────
    useEffect(() => {
        if (!roomId) return

        // Reset for new room
        lastSeqRef.current = -1
        queueRef.current = []
        playingRef.current = false
        pollingRef.current = false
        if (currentAudio.current) {
            currentAudio.current.pause()
            currentAudio.current = null
        }

        const poll = async () => {
            // ── Concurrency guard: skip if previous poll is still running ──
            if (pollingRef.current) return
            pollingRef.current = true

            try {
                const state = await getLiveState(roomId)

                if (!state || !state.active) {
                    // Stream stopped
                    if (lastSeqRef.current >= 0) {
                        lastSeqRef.current = -1
                        queueRef.current = []
                        if (currentAudio.current) {
                            currentAudio.current.pause()
                            currentAudio.current = null
                        }
                        playingRef.current = false
                    }
                    return
                }

                if (state.paused) return

                const mimeType = state.mimeType || 'audio/webm'

                // Only fetch chunks we haven't seen yet
                // If we're very far behind (>3 chunks), skip old ones to stay near real-time
                let nextSeq = lastSeqRef.current + 1
                const latestSeq = state.seq

                if (latestSeq - nextSeq > 3) {
                    // Skip ahead — only play the most recent 2 chunks to stay near live
                    console.debug(`[Live] skipping ${latestSeq - nextSeq - 1} old chunks to catch up`)
                    nextSeq = Math.max(nextSeq, latestSeq - 1)
                    // Clear stale queue
                    queueRef.current = []
                    if (currentAudio.current) {
                        currentAudio.current.pause()
                        currentAudio.current = null
                        playingRef.current = false
                    }
                }

                // Download only the NEW chunk(s) — usually just 1
                while (nextSeq <= latestSeq) {
                    const dataUri = await downloadLiveChunk(roomId, nextSeq, mimeType)
                    if (!dataUri) break

                    console.debug(`[Live] got chunk ${nextSeq}`)
                    queueRef.current.push(dataUri)
                    lastSeqRef.current = nextSeq
                    nextSeq++
                }

                // Kick off playback if not already playing
                if (!playingRef.current && queueRef.current.length > 0) {
                    playNext()
                }
            } catch (err) {
                console.debug('[Live] poll error', err)
            } finally {
                pollingRef.current = false   // ← always release the guard
            }
        }

        // Poll every 2s (matches ~2s recording cycle)
        pollRef.current = setInterval(poll, 2000)
        poll()  // immediate first poll

        return () => {
            clearInterval(pollRef.current)
            pollingRef.current = false
            if (currentAudio.current) {
                currentAudio.current.pause()
                currentAudio.current = null
            }
            queueRef.current = []
            playingRef.current = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId])
}
