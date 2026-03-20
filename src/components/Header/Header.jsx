import { useState, useEffect } from 'react'
import './Header.css'

function Header() {
  const [showAbout, setShowAbout] = useState(false)

  // Close on Escape
  useEffect(() => {
    if (!showAbout) return
    const onKey = (e) => { if (e.key === 'Escape') setShowAbout(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAbout])

  return (
    <>
      <header className="header">
        <div className="logo">
          <span className="logo-icon">◉</span>
          <span className="logo-text">EchoCast</span>
        </div>
        <nav className="nav">
          <button className="nav-link about-btn" onClick={() => setShowAbout(true)}>About</button>
        </nav>
      </header>

      {/* ── About Credits Popup ── */}
      {showAbout && (
        <div className="about-overlay" onClick={() => setShowAbout(false)}>
          <div className="about-window" onClick={e => e.stopPropagation()}>
            <button className="about-close" onClick={() => setShowAbout(false)}>×</button>

            {/* Star Wars scrolling credits */}
            <div className="about-scroll-mask">
              <div className="about-scroll-content">

                <div className="about-logo-section">
                  <span className="about-logo-icon">◉</span>
                  <h2 className="about-title">EchoCast</h2>
                  <p className="about-tagline">Real-Time Audio Streaming Platform</p>
                </div>

                <div className="about-divider" />

                <div className="about-section">
                  <h3 className="about-heading">About the Project</h3>
                  <p className="about-text">
                    EchoCast is a real-time audio broadcasting platform that
                    allows creators to capture and share live browser audio
                    to connected listeners across multiple devices, simultaneously
                    and in perfect sync.
                  </p>
                  <p className="about-text">
                    Whether you're streaming music, a podcast, a lecture, or
                    any browser-based audio — EchoCast broadcasts it instantly
                    to every connected device in the room.
                  </p>
                </div>

                <div className="about-section">
                  <h3 className="about-heading">Key Features</h3>
                  <p className="about-text">✦ Live browser tab audio capture &amp; streaming</p>
                  <p className="about-text">✦ Real-time synchronized playback across devices</p>
                  <p className="about-text">✦ Room-based multi-device connectivity</p>
                  <p className="about-text">✦ QR code &amp; join-code instant access</p>
                  <p className="about-text">✦ Ultra-low latency WebRTC audio streaming</p>
                  <p className="about-text">✦ Floating live control widget across tabs</p>
                  <p className="about-text">✦ Creator/listener architecture with room controls</p>
                </div>

                <div className="about-divider" />

                <div className="about-section">
                  <h3 className="about-heading">Developed By</h3>
                  <p className="about-credit-name">Akhil Mohanan</p>
                  <p className="about-credit-role">Full-Stack Developer &amp; Creator</p>
                </div>

                <div className="about-divider" />

                <div className="about-section">
                  <h3 className="about-heading">Tech Stack</h3>
                  <p className="about-text">React · Vite · WebRTC</p>
                  <p className="about-text">LiveKit SFU · Opus Codec</p>
                  <p className="about-text">WebSocket Signaling · getDisplayMedia</p>
                  <p className="about-text">Node.js · livekit-server-sdk</p>
                </div>

                <div className="about-divider" />

                <div className="about-section">
                  <p className="about-year">© 2026 EchoCast</p>
                  <p className="about-text about-final">Crafted with ♥ by Akhil Mohanan</p>
                </div>

                {/* Spacer for smooth scroll loop */}
                <div style={{ height: '200px' }} />

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Header
