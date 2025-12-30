import { useState } from 'react'
import { Header, Button, Footer } from '../../components'
import './Landing.css'
import { createRoom } from '../../services/roomService'

function Landing() {
  const [roomDetails, setRoomDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreateRoom = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await createRoom()
      setRoomDetails(data)
    } catch (err) {
      setError(err.message || 'Unable to create room right now.')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRoom = () => {
    // Placeholder for join flow; could open a modal or navigate when backend is ready.
    alert('Enter a room ID and code on the join page (coming soon).')
  }

  return (
    <div className="landing">
      <Header />
      
      <main className="hero">
        <h1 className="hero-title">EchoCast</h1>
        <p className="hero-subtitle">
          Connect and communicate in real-time audio rooms
        </p>
        <div className="button-group">
          <Button variant="primary" onClick={handleCreateRoom} loading={loading}>
            Create Room
          </Button>
          <Button variant="secondary" onClick={handleJoinRoom} disabled={loading}>
            Join Room
          </Button>
        </div>

        {error && <div className="status status-error">{error}</div>}

        {roomDetails && (
          <section className="room-card">
            <div className="room-meta">
              <div className="meta-item">
                <span className="meta-label">Room ID</span>
                <span className="meta-value">{roomDetails.roomId}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Join Code</span>
                <span className="meta-value code">{roomDetails.roomCode}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Join URL</span>
                <a className="meta-link" href={roomDetails.joinUrl} target="_blank" rel="noreferrer">
                  {roomDetails.joinUrl}
                </a>
              </div>
            </div>
            <div className="qr-block">
              <img src={roomDetails.qrDataUrl} alt="Room QR code" className="qr-image" />
              <p className="qr-caption">Scan to join the room</p>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default Landing
