import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import '../Landing/Landing.css'

function RoomConnectedPage() {
  const { state } = useLocation()
  const room = state?.room || state // allow both shapes
  const navigate = useNavigate()

  return (
    <div className="landing">
      <Header />

      <main className="hero">
        <h1 className="hero-title">Room connected</h1>
        <p className="hero-subtitle">You are in. Share the link or QR to invite others.</p>

        {room ? (
          <section className="room-card">
            <div className="room-meta">
              <div className="meta-item">
                <span className="meta-label">Room ID</span>
                <span className="meta-value">{room.roomId}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Join Code</span>
                <span className="meta-value code">{room.roomCode}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Join URL</span>
                <a className="meta-link" href={room.joinUrl} target="_blank" rel="noreferrer">
                  {room.joinUrl}
                </a>
              </div>
            </div>
            <div className="qr-block">
              <img src={room.qrDataUrl} alt="Room QR code" className="qr-image" />
              <p className="qr-caption">Scan to join the room</p>
            </div>
          </section>
        ) : (
          <div className="status status-error">Missing room info. Please re-join.</div>
        )}

        <div className="button-group">
          <Button variant="primary" onClick={() => navigate('/create')}>
            Create another room
          </Button>
          <Button variant="secondary" onClick={() => navigate('/')}>Back to home</Button>
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default RoomConnectedPage
