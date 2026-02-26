import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { setLiveState, getLiveState, uploadChunkAndState } from '../services/liveStreamService'

const AudioStreamContext = createContext(null)

const BC = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('echocast_stream') : null

export function AudioStreamProvider({ children }) {
    const [isStreaming, setIsStreaming] = useState(false)
    const [isPaused, setIsPaused] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [permissionError, setPermissionError] = useState(null)

    // Refs that are safe to use inside callbacks without re-renders
    const streamRef = useRef(null)
    const recorderRef = useRef(null)
    const timerRef = useRef(null)
    const seqRef = useRef(0)
    const elapsedRef = useRef(0)
    const roomIdRef = useRef(null)
    const popupRef = useRef(null)
    const streamingRef = useRef(false)
    const pausedRef = useRef(false)

    // ── Broadcast helpers ──────────────────────────────────────────────
    const broadcast = useCallback((extra = {}) => {
        if (!BC) return
        BC.postMessage({
            type: 'STATE_UPDATE',
            streaming: streamingRef.current,
            paused: pausedRef.current,
            elapsed: elapsedRef.current,
            ...extra,
        })
    }, [])

    // ── Timer ──────────────────────────────────────────────────────────
    const startTimer = useCallback(() => {
        clearInterval(timerRef.current)
        timerRef.current = setInterval(() => {
            elapsedRef.current += 1
            setElapsed(elapsedRef.current)
            broadcast()
        }, 1000)
    }, [broadcast])

    const stopTimer = useCallback(() => {
        clearInterval(timerRef.current)
        timerRef.current = null
        elapsedRef.current = 0
        setElapsed(0)
    }, [])

    // ── Popup widget ───────────────────────────────────────────────────
    const openPopup = useCallback(() => {
        if (popupRef.current && !popupRef.current.closed) return
        const w = 240, h = 310
        const left = window.screen.width - w - 20
        const top = window.screen.height - h - 60
        const popup = window.open(
            '/stream-widget.html',
            'echocast_widget',
            `width=${w},height=${h},left=${left},top=${top},resizable=no,scrollbars=no,toolbar=no,menubar=no,location=no,status=no,titlebar=no`
        )
        popupRef.current = popup
    }, [])

    const closePopup = useCallback(() => {
        if (popupRef.current && !popupRef.current.closed) {
            popupRef.current.close()
        }
        popupRef.current = null
    }, [])

    // ── MediaRecorder (streams audio chunks to Redis) ──────────────────
    // Strategy: stop-then-restart cycle so EVERY blob is a COMPLETE,
    // independently playable audio file (includes its own WebM header).
    // Cycle length: ~500ms for near-real-time latency.
    const startRecording = useCallback((mediaStream, roomId) => {
        if (!roomId) return
        roomIdRef.current = roomId
        seqRef.current = 0

        const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg']
            .find(m => MediaRecorder.isTypeSupported(m)) || ''

        const mimeForState = mimeType.split(';')[0] || 'audio/webm'

        let cycleTimer = null
        let currentRecorder = null
        let stopped = false

        const recordOneCycle = () => {
            if (stopped) return
            if (mediaStream.getAudioTracks().every(t => t.readyState === 'ended')) {
                return
            }

            const rec = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {})

            rec.ondataavailable = async (e) => {
                if (!e.data || e.data.size === 0) return
                const seq = seqRef.current++
                try {
                    const buf = await e.data.arrayBuffer()
                    // Use pipeline: upload chunk + update state in ONE HTTP request
                    await uploadChunkAndState(roomId, seq, buf, {
                        active: true,
                        paused: pausedRef.current,
                        seq,
                        mimeType: mimeForState,
                        ts: Date.now(),
                    })
                } catch (err) {
                    console.warn('[EchoCast] chunk upload error', err)
                }
            }

            rec.onstop = () => {
                if (!stopped) {
                    cycleTimer = setTimeout(recordOneCycle, 10)  // minimal gap (10ms)
                }
            }

            rec.start()
            currentRecorder = rec

            // Stop this recorder after ~500ms to produce a complete blob
            setTimeout(() => {
                if (rec.state === 'recording') {
                    rec.stop()
                }
            }, 500)
        }

        recordOneCycle()

        recorderRef.current = {
            stop() {
                stopped = true
                clearTimeout(cycleTimer)
                if (currentRecorder && currentRecorder.state === 'recording') {
                    currentRecorder.stop()
                }
            }
        }
    }, [])

    const stopRecording = useCallback(() => {
        if (recorderRef.current && recorderRef.current.stop) {
            recorderRef.current.stop()
        }
        recorderRef.current = null
    }, [])

    // ── BroadcastChannel → handle commands from popup ─────────────────
    useEffect(() => {
        if (!BC) return
        const handler = (e) => {
            const msg = e.data
            if (msg.type === 'CMD_PAUSE') pauseStream()
            else if (msg.type === 'CMD_RESUME') resumeStream()
            else if (msg.type === 'CMD_STOP') stopStream()
            else if (msg.type === 'CMD_REQUEST_STATE') broadcast()
        }
        BC.addEventListener('message', handler)
        return () => BC.removeEventListener('message', handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── startStream ────────────────────────────────────────────────────
    const startStream = useCallback(async (roomId) => {
        setPermissionError(null)
        try {
            const mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,   // Chrome requires video:true
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    channelCount: 2,
                    sampleRate: 48000,
                },
            })

            // Drop video — we only want audio
            mediaStream.getVideoTracks().forEach(t => t.stop())

            if (mediaStream.getAudioTracks().length === 0) {
                mediaStream.getTracks().forEach(t => t.stop())
                setPermissionError('No audio was shared. Tick "Share tab audio" in the Chrome picker.')
                return false
            }

            // Auto-stop when browser's "Stop sharing" bar is clicked
            mediaStream.getAudioTracks().forEach(t => {
                t.addEventListener('ended', () => stopStream())
            })

            streamRef.current = mediaStream
            streamingRef.current = true
            pausedRef.current = false
            setIsStreaming(true)
            setIsPaused(false)

            startTimer()
            startRecording(mediaStream, roomId)
            openPopup()
            broadcast({ streaming: true, paused: false, elapsed: 0 })
            return true
        } catch (err) {
            if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
                setPermissionError(err.message || 'Could not capture browser audio.')
            }
            return false
        }
    }, [startTimer, startRecording, openPopup, broadcast])

    // ── pauseStream ────────────────────────────────────────────────────
    const pauseStream = useCallback(() => {
        if (!streamRef.current) return
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = false })
        if (recorderRef.current && recorderRef.current.state === 'recording') {
            recorderRef.current.pause()
        }
        pausedRef.current = true
        setIsPaused(true)
        clearInterval(timerRef.current)
        broadcast({ paused: true })

        // Tell slaves we're paused
        if (roomIdRef.current) {
            setLiveState(roomIdRef.current, {
                active: true, paused: true, seq: seqRef.current - 1, ts: Date.now()
            }).catch(() => { })
        }
    }, [broadcast])

    // ── resumeStream ───────────────────────────────────────────────────
    const resumeStream = useCallback(() => {
        if (!streamRef.current) return
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = true })
        if (recorderRef.current && recorderRef.current.state === 'paused') {
            recorderRef.current.resume()
        }
        pausedRef.current = false
        setIsPaused(false)
        startTimer()
        broadcast({ paused: false })
    }, [startTimer, broadcast])

    // ── stopStream ────────────────────────────────────────────────────
    const stopStream = useCallback(() => {
        stopRecording()
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop())
            streamRef.current = null
        }

        if (roomIdRef.current) {
            setLiveState(roomIdRef.current, {
                active: false, paused: false, seq: seqRef.current - 1, ts: Date.now()
            }).catch(() => { })
        }

        streamingRef.current = false
        pausedRef.current = false
        setIsStreaming(false)
        setIsPaused(false)
        stopTimer()
        closePopup()
        broadcast({ streaming: false, paused: false, elapsed: 0 })
    }, [stopRecording, stopTimer, closePopup, broadcast])

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
