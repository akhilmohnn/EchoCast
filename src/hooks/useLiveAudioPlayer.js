/**
 * useLiveAudioPlayer.js
 * -------------------------------------------------------------------
 * Slave-side real-time audio player — optimised for low latency.
 *
 * Design goals:
 *   - Play audio chunks with minimal delay after the master records them
 *   - Never queue up stale chunks — always stay near live
 *   - Use blob URLs (much faster than data URIs) for instant playback
 *   - Aggressive catch-up: skip old chunks if we fall behind
 *   - Overlap playback prep: pre-fetch next chunk while current plays
 *
 * Polling interval: ~600ms (matches the ~500ms recording cycle with buffer)
 * -------------------------------------------------------------------
 */

import { useEffect, useRef } from 'react'
import { getLiveState, downloadLiveChunk } from '../services/liveStreamService'

export function useLiveAudioPlayer(roomId, enabled) {
    const lastSeqRef = useRef(-1)
    const pollRef = useRef(null)
    const currentAudio = useRef(null)
    const queueRef = useRef([])        // [{blobUrl, seq}]
    const enabledRef = useRef(enabled)
    const playingRef = useRef(false)
    const pollingRef = useRef(false)
    const blobUrlsRef = useRef([])     // track blob URLs for cleanup
    const mimeRef = useRef('audio/webm')

    // Keep enabled in sync without restarting polling
    useEffect(() => {
        enabledRef.current = enabled
        if (currentAudio.current) {
            currentAudio.current.muted = !enabled
        }
    }, [enabled])

    // ── Revoke old blob URLs to prevent memory leaks ─────────────────
    const revokeBlobUrl = (url) => {
        try { URL.revokeObjectURL(url) } catch { /* noop */ }
    }

    const revokeAllBlobs = () => {
        blobUrlsRef.current.forEach(revokeBlobUrl)
        blobUrlsRef.current = []
    }

    // ── Convert ArrayBuffer to blob URL ─────────────────────────────
    const toBlobUrl = (arrayBuffer, mime) => {
        const blob = new Blob([arrayBuffer], { type: mime })
        const url = URL.createObjectURL(blob)
        blobUrlsRef.current.push(url)
        return url
    }

    // ── Play next in queue (sequential, one at a time) ──────────────
    const playNext = () => {
        if (queueRef.current.length === 0) {
            playingRef.current = false
            return
        }

        playingRef.current = true
        const { blobUrl } = queueRef.current.shift()
        const audio = new Audio(blobUrl)
        audio.muted = !enabledRef.current
        currentAudio.current = audio

        audio.addEventListener('ended', () => {
            revokeBlobUrl(blobUrl)
            currentAudio.current = null
            playNext()
        }, { once: true })

        audio.addEventListener('error', () => {
            revokeBlobUrl(blobUrl)
            currentAudio.current = null
            playNext()
        }, { once: true })

        audio.play().catch(() => {
            revokeBlobUrl(blobUrl)
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
        revokeAllBlobs()
        if (currentAudio.current) {
            currentAudio.current.pause()
            currentAudio.current = null
        }

        const poll = async () => {
            // Concurrency guard
            if (pollingRef.current) return
            pollingRef.current = true

            try {
                const state = await getLiveState(roomId)

                if (!state || !state.active) {
                    // Stream stopped
                    if (lastSeqRef.current >= 0) {
                        lastSeqRef.current = -1
                        queueRef.current = []
                        revokeAllBlobs()
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
                mimeRef.current = mimeType

                const latestSeq = state.seq
                let nextSeq = lastSeqRef.current + 1

                // ── Aggressive catch-up ──
                // With 500ms chunks, if we're >2 chunks behind, skip to near-live.
                // Only grab the very latest chunk to minimize delay.
                if (latestSeq - nextSeq > 2) {
                    // Drop everything stale — jump to the latest chunk
                    queueRef.current = []
                    revokeAllBlobs()
                    if (currentAudio.current) {
                        currentAudio.current.pause()
                        currentAudio.current = null
                        playingRef.current = false
                    }
                    nextSeq = latestSeq  // only fetch the latest
                }

                // Download new chunks (usually just 1)
                while (nextSeq <= latestSeq) {
                    const arrayBuffer = await downloadLiveChunk(roomId, nextSeq)
                    if (!arrayBuffer) break

                    const blobUrl = toBlobUrl(arrayBuffer, mimeType)
                    queueRef.current.push({ blobUrl, seq: nextSeq })
                    lastSeqRef.current = nextSeq
                    nextSeq++
                }

                // Kick off playback
                if (!playingRef.current && queueRef.current.length > 0) {
                    playNext()
                }
            } catch (err) {
                // Silently handle — will retry next poll
            } finally {
                pollingRef.current = false
            }
        }

        // Poll every 600ms (slightly more than the 500ms recording cycle)
        pollRef.current = setInterval(poll, 600)
        poll()  // immediate first poll

        return () => {
            clearInterval(pollRef.current)
            pollingRef.current = false
            revokeAllBlobs()
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
