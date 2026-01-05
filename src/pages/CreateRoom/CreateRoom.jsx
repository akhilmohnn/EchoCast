import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import '../Landing/Landing.css'
import { createRoom } from '../../services/roomService'

function CreateRoomPage() {
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const generateRoom = async () => {
    setLoading(true)
    setError('')
    try {
      const data = await createRoom()
      setRoom(data)
    } catch (err) {
      setRoom(null)
      setError(err.message || 'Unable to create room right now.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generateRoom()
  }, [])

  return (
    <div className="landing">
      <Header />

      <main className="hero">
        <h1 className="hero-title">Create Room</h1>
        <p className="hero-subtitle">Generate a room ID, code, and QR for quick sharing.</p>

        <div className="button-group">
          <Button variant="primary" onClick={generateRoom} loading={loading}>
            Generate New Room
          </Button>
          <Button
            variant="secondary"
            onClick={() => navigate('/join')}
            disabled={loading}
          >
            Go to Join
          </Button>
        </div>

        {error && <div className="status status-error">{error}</div>}

        {room && (
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
        )}
      </main>

      <Footer />
    </div>
  )
}

export default CreateRoomPage
