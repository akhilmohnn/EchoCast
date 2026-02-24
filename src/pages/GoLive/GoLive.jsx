import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { removeParticipant, getParticipants } from '../../services/roomService'
import './GoLive.css'

function GoLivePage() {
    const { state } = useLocation()
    const room = state?.room || state
    const navigate = useNavigate()

    const [isStreaming, setIsStreaming] = useState(false)
    const [elapsed, setElapsed] = useState(0)
    const [showInvite, setShowInvite] = useState(false)

    // Tick a live timer while streaming
    useEffect(() => {
        if (!isStreaming) { setElapsed(0); return }
        const t = setInterval(() => setElapsed(s => s + 1), 1000)
        return () => clearInterval(t)
    }, [isStreaming])

    // Close popup on Escape
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') setShowInvite(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    const fmtTime = (s) => {
        const h = String(Math.floor(s / 3600)).padStart(2, '0')
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
        const sec = String(s % 60).padStart(2, '0')
        return `${h}:${m}:${sec}`
    }

    const handleCloseRoom = async () => {
        if (!window.confirm('Close the room? All participants will be disconnected.')) return
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
                        <button className="gl-invite-btn" onClick={() => setShowInvite(true)}>
                            <svg viewBox="0 0 24 24" fill="currentColor" className="gl-invite-icon">
                                <path d="M3 5h2V3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 2H3v14h10v-2H7a2 2 0 0 1-2-2V7zm14-4H7v14h12V3z" />
                            </svg>
                            Invite
                        </button>

                        <div className={`gl-badge ${isStreaming ? 'gl-badge--live' : ''}`}>
                            <span className="gl-badge-dot" />
                            {isStreaming ? 'LIVE' : 'STANDBY'}
                        </div>
                    </div>
                </header>

                {/* ── Hero ── */}
                <section className="gl-hero">
                    <p className="gl-hero-eyebrow">CREATOR STUDIO</p>
                    <h1 className="gl-hero-title">
                        {isStreaming ? (
                            <>You&rsquo;re <span className="gl-accent">Live</span></>
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
                </section>

                {/* ── Main stream button ── */}
                <div className="gl-stream-wrap">
                    <button
                        className={`gl-stream-btn ${isStreaming ? 'gl-stream-btn--stop' : 'gl-stream-btn--start'}`}
                        onClick={() => setIsStreaming(p => !p)}
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

            {/* ── Invite / QR Popup ── */}
            {showInvite && (
                <div className="gl-popup-overlay" onClick={() => setShowInvite(false)}>
                    <div className="gl-popup" onClick={e => e.stopPropagation()}>
                        {/* Close button */}
                        <button className="gl-popup-close" onClick={() => setShowInvite(false)}>×</button>

                        <p className="gl-popup-eyebrow">Share & Invite</p>
                        <h2 className="gl-popup-title">Join the Room</h2>

                        {/* QR */}
                        {room?.qrDataUrl && (
                            <div className="gl-popup-qr-frame">
                                <img src={room.qrDataUrl} alt="Scan to join" className="gl-popup-qr-img" />
                            </div>
                        )}

                        <p className="gl-popup-caption">Scan to join instantly</p>

                        {/* Room code */}
                        {room?.roomCode && (
                            <div className="gl-popup-code-row">
                                <span className="gl-popup-code-label">Code</span>
                                <span className="gl-popup-code">{room.roomCode}</span>
                            </div>
                        )}

                        {/* Join URL */}
                        {room?.joinUrl && (
                            <div className="gl-popup-url">{room.joinUrl}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default GoLivePage
