import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAudioStream } from '../../context/AudioStreamContext'
import './FloatingStreamWidget.css'

function fmtTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, '0')
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const sec = String(s % 60).padStart(2, '0')
    return `${h}:${m}:${sec}`
}

export default function FloatingStreamWidget() {
    const { isStreaming, isPaused, elapsed, stopStream, pauseStream, resumeStream } = useAudioStream()
    const navigate = useNavigate()

    if (!isStreaming) return null

    return createPortal(
        <div className="fsw-widget" role="complementary" aria-label="Live stream controls">
            {/* Glow ring */}
            <div className={`fsw-ring ${isPaused ? 'fsw-ring--paused' : 'fsw-ring--live'}`} />

            {/* Status badge */}
            <div className={`fsw-badge ${isPaused ? 'fsw-badge--paused' : 'fsw-badge--live'}`}>
                <span className="fsw-badge-dot" />
                <span>{isPaused ? 'PAUSED' : 'LIVE'}</span>
            </div>

            {/* Timer */}
            <div className="fsw-timer">{fmtTime(elapsed)}</div>

            {/* Audio wave bars (visual only) */}
            {!isPaused && (
                <div className="fsw-wave" aria-hidden="true">
                    {[...Array(5)].map((_, i) => (
                        <span key={i} className="fsw-wave-bar" style={{ animationDelay: `${i * 0.12}s` }} />
                    ))}
                </div>
            )}

            {/* Controls */}
            <div className="fsw-controls">
                {/* Pause / Resume */}
                <button
                    className={`fsw-btn fsw-btn--pause ${isPaused ? 'fsw-btn--resume' : ''}`}
                    onClick={isPaused ? resumeStream : pauseStream}
                    title={isPaused ? 'Resume audio' : 'Pause audio'}
                    aria-label={isPaused ? 'Resume audio' : 'Pause audio'}
                >
                    {isPaused ? (
                        /* Play icon */
                        <svg viewBox="0 0 24 24" fill="currentColor" className="fsw-icon">
                            <polygon points="6,4 20,12 6,20" />
                        </svg>
                    ) : (
                        /* Pause icon */
                        <svg viewBox="0 0 24 24" fill="currentColor" className="fsw-icon">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                    )}
                </button>

                {/* Back to GoLive page */}
                <button
                    className="fsw-btn fsw-btn--golive"
                    onClick={() => navigate('/golive')}
                    title="Back to Go Live page"
                    aria-label="Go to GoLive page"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="fsw-icon">
                        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
                    </svg>
                </button>

                {/* Stop */}
                <button
                    className="fsw-btn fsw-btn--stop"
                    onClick={stopStream}
                    title="Stop streaming"
                    aria-label="Stop streaming"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="fsw-icon">
                        <rect x="5" y="5" width="14" height="14" rx="2" />
                    </svg>
                </button>
            </div>

            <span className="fsw-label">EchoCast Live</span>
        </div>,
        document.body
    )
}
