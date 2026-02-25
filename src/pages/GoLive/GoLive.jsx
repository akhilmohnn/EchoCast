import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { removeParticipant, getParticipants } from '../../services/roomService'
import { useAudioStream } from '../../context/AudioStreamContext'
import './GoLive.css'

function fmtTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, '0')
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const sec = String(s % 60).padStart(2, '0')
    return `${h}:${m}:${sec}`
}

function GoLivePage() {
    const { state } = useLocation()
    const room = state?.room || state
    const navigate = useNavigate()

    const {
        isStreaming,
        isPaused,
        elapsed,
        startStream,
        stopStream,
        pauseStream,
        resumeStream,
        permissionError,
    } = useAudioStream()

    // Close popup on Escape — reused for any future modal
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') { } }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const handleToggleStream = async () => {
        if (isStreaming) {
            stopStream()
        } else {
            await startStream(room?.roomId)
        }
    }

    const handleTogglePause = () => {
        if (isPaused) resumeStream()
        else pauseStream()
    }

    const handleCloseRoom = async () => {
        if (!window.confirm('Close the room? All participants will be disconnected.')) return
        stopStream()
        try {
            const participants = await getParticipants(room.roomId)
            await Promise.all(participants.map(p => removeParticipant(room.roomId, p)))
        } catch (err) {
            console.error('Error closing room', err)
        }
        navigate('/')
    }

    return (
        <div className="gl-root">
            {/* Ambient background orbs */}
            <div className="gl-orb gl-orb--purple" />
            <div className="gl-orb gl-orb--blue" />
            <div className="gl-orb gl-orb--red" />

            {/* Noise overlay */}
            <div className="gl-noise" />

            {/* Page content */}
            <div className="gl-content">

                {/* ── Header strip ── */}
                <header className="gl-header">
                    <div className="gl-logo">
                        <span className="gl-logo-dot" />
                        EchoCast Studio
                    </div>

                    <div className="gl-header-right">
                        {/* Invite / QR button — top right */}
                        {room?.qrDataUrl && (
                            <button className="gl-invite-btn" onClick={() => navigate('/connected', { state: room })}>
                                <svg viewBox="0 0 24 24" fill="currentColor" className="gl-invite-icon">
                                    <path d="M3 5h2V3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 2H3v14h10v-2H7a2 2 0 0 1-2-2V7zm14-4H7v14h12V3z" />
                                </svg>
                                Room
                            </button>
                        )}

                        <div className={`gl-badge ${isStreaming && !isPaused ? 'gl-badge--live' : ''}`}>
                            <span className="gl-badge-dot" />
                            {isStreaming ? (isPaused ? 'PAUSED' : 'LIVE') : 'STANDBY'}
                        </div>
                    </div>
                </header>

                {/* ── Hero ── */}
                <section className="gl-hero">
                    <p className="gl-hero-eyebrow">CREATOR STUDIO</p>
                    <h1 className="gl-hero-title">
                        {isStreaming ? (
                            isPaused
                                ? <>Stream <span className="gl-accent">Paused</span></>
                                : <>You&rsquo;re <span className="gl-accent">Live</span></>
                        ) : (
                            <>Ready to<br /><span className="gl-accent">Go Live?</span></>
                        )}
                    </h1>

                    {isStreaming && (
                        <div className="gl-timer">
                            <span className="gl-timer-dot" />
                            {fmtTime(elapsed)}
                        </div>
                    )}

                    {permissionError && (
                        <p style={{ fontSize: '0.82rem', color: '#f87171', textAlign: 'center', maxWidth: '340px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '10px', padding: '0.5rem 1rem', margin: '0' }}>
                            {permissionError}
                        </p>
                    )}
                </section>

                {/* ── Main stream button ── */}
                <div className="gl-stream-wrap">
                    <button
                        className={`gl-stream-btn ${isStreaming ? 'gl-stream-btn--stop' : 'gl-stream-btn--start'}`}
                        onClick={handleToggleStream}
                    >
                        <span className="gl-stream-btn-ring" />
                        <span className="gl-stream-btn-inner">
                            <svg className="gl-stream-icon" viewBox="0 0 24 24" fill="currentColor">
                                {isStreaming
                                    ? <rect x="5" y="5" width="14" height="14" rx="2" />
                                    : <polygon points="6,4 20,12 6,20" />}
                            </svg>
                            <span className="gl-stream-label">
                                {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
                            </span>
                        </span>
                    </button>
                </div>

                {/* ── Pause/Resume row (only when live) ── */}
                {isStreaming && (
                    <div className="gl-actions">
                        <button
                            className={`gl-action-btn ${isPaused ? 'gl-action-btn--home' : 'gl-action-btn--pause'}`}
                            onClick={handleTogglePause}
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor" className="gl-action-icon">
                                {isPaused
                                    ? <polygon points="6,4 20,12 6,20" />
                                    : <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>
                                }
                            </svg>
                            {isPaused ? 'Resume Audio' : 'Pause Audio'}
                        </button>
                    </div>
                )}

                {/* ── Action buttons ── */}
                <div className="gl-actions">
                    <button className="gl-action-btn gl-action-btn--home" onClick={() => navigate(-1)}>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="gl-action-icon">
                            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                        </svg>
                        Go to Home
                    </button>

                    <button className="gl-action-btn gl-action-btn--danger" onClick={handleCloseRoom}>
                        <svg viewBox="0 0 24 24" fill="currentColor" className="gl-action-icon">
                            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                        </svg>
                        Close Room
                    </button>
                </div>

            </div>
        </div>
    )
}

export default GoLivePage
