/**
 * useLiveAudioPlayer.js
 * -------------------------------------------------------------------
 * Slave-side real-time audio player — Web Audio API for gapless playback.
 *
 * Key improvements:
 *   - AudioContext + AudioBufferSourceNode for sample-accurate scheduling
 *   - Gapless: each buffer is scheduled to start exactly when the previous ends
 *   - Batch pipeline downloads (multiple chunks + state in one HTTP request)
 *   - Smooth catch-up: if >6 chunks behind, jump to near-live (not hard drop)
 *   - GainNode for instant mute/unmute without interrupting playback
 *   - Polling at ~450ms (aligned with 400ms recording cycles)
 * -------------------------------------------------------------------
 */

import { useEffect, useRef } from 'react'
import { downloadMultipleChunksAndState } from '../services/liveStreamService'

export function useLiveAudioPlayer(roomId, enabled) {
    const lastSeqRef = useRef(-1)
    const pollRef = useRef(null)
    const enabledRef = useRef(enabled)
    const pollingRef = useRef(false)
    const audioCtxRef = useRef(null)
    const gainNodeRef = useRef(null)
    const nextPlayTimeRef = useRef(0)
    const activeSourcesRef = useRef([])

    // ── Keep enabled in sync (mute/unmute via GainNode) ──────────────
    useEffect(() => {
        enabledRef.current = enabled
        if (enabled && audioCtxRef.current?.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => { })
        }
        if (gainNodeRef.current && audioCtxRef.current) {
            gainNodeRef.current.gain.setValueAtTime(
                enabled ? 1 : 0,
                audioCtxRef.current.currentTime
            )
        }
    }, [enabled])

    // ── Get or create AudioContext ───────────────────────────────────
    const ensureAudioContext = () => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
            const ctx = new (window.AudioContext || window.webkitAudioContext)()
            audioCtxRef.current = ctx
            const gain = ctx.createGain()
            gain.gain.value = enabledRef.current ? 1 : 0
            gain.connect(ctx.destination)
            gainNodeRef.current = gain
        }
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => { })
        }
        return audioCtxRef.current
    }

    // ── Schedule an AudioBuffer for gapless playback ────────────────
    const scheduleBuffer = (audioBuffer) => {
        const ctx = ensureAudioContext()
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(gainNodeRef.current)

        const now = ctx.currentTime
        let when = nextPlayTimeRef.current

        // If scheduled time is in the past, play immediately (with tiny offset to avoid click)
        if (when < now) {
            when = now + 0.005
        }

        // If we've buffered too far ahead (>2.5s), reset to now
        if (when - now > 2.5) {
            when = now + 0.005
        }

        source.start(when)
        nextPlayTimeRef.current = when + audioBuffer.duration

        // Track for cleanup
        activeSourcesRef.current.push(source)
        source.onended = () => {
            activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source)
        }
    }

    // ── Stop all scheduled playback ─────────────────────────────────
    const stopAll = () => {
        for (const src of activeSourcesRef.current) {
            try { src.stop() } catch { /* already stopped */ }
        }
        activeSourcesRef.current = []
        nextPlayTimeRef.current = 0
    }

    // ── Cleanup AudioContext ────────────────────────────────────────
    const fullCleanup = () => {
        clearInterval(pollRef.current)
        pollingRef.current = false
        stopAll()
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            audioCtxRef.current.close().catch(() => { })
        }
        audioCtxRef.current = null
        gainNodeRef.current = null
    }

    // ── Main polling loop ───────────────────────────────────────────
    useEffect(() => {
        if (!roomId) return

        // Reset for new room
        lastSeqRef.current = -1
        pollingRef.current = false
        stopAll()

        const poll = async () => {
            if (pollingRef.current) return
            pollingRef.current = true

            try {
                const nextSeq = lastSeqRef.current + 1

                // Speculatively fetch next 4 chunks + state in ONE pipeline request.
                // Chunks that don't exist yet simply return null and are skipped.
                const seqs = []
                for (let i = 0; i < 4; i++) seqs.push(nextSeq + i)

                const { chunks, state } = await downloadMultipleChunksAndState(roomId, seqs)

                // ── Stream not active ──
                if (!state || !state.active) {
                    if (lastSeqRef.current >= 0) {
                        lastSeqRef.current = -1
                        stopAll()
                    }
                    return
                }

                // ── Paused ──
                if (state.paused) return

                const latestSeq = state.seq

                // ── Smooth catch-up ──
                // If we're more than 6 chunks behind (~2.4s at 400ms cycles),
                // jump to near-live instead of trying to play everything sequentially.
                if (latestSeq - lastSeqRef.current > 6) {
                    stopAll()
                    lastSeqRef.current = latestSeq - 1
                    return // next poll will fetch from near-live
                }

                if (chunks.length === 0) return

                const ctx = ensureAudioContext()

                for (const { seq, arrayBuffer } of chunks) {
                    if (seq <= lastSeqRef.current) continue
                    if (seq > latestSeq) break

                    try {
                        // decodeAudioData consumes the buffer, so pass a copy
                        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
                        scheduleBuffer(decoded)
                        lastSeqRef.current = seq
                    } catch {
                        // Skip undecodable chunks (corrupted or unsupported format)
                        lastSeqRef.current = seq
                    }
                }
            } catch {
                // Will retry on next poll
            } finally {
                pollingRef.current = false
            }
        }

        // Poll every 450ms — tighter than the 400ms recording cycle
        pollRef.current = setInterval(poll, 450)
        poll() // immediate first poll

        return fullCleanup
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId])
}
