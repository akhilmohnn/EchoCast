import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import '../Landing/Landing.css'
import './JoinRoom.css'
import { joinRoom } from '../../services/roomService'

function JoinRoomPage() {
  const [searchParams] = useSearchParams()
  const [roomId, setRoomId] = useState(searchParams.get('room') || '')
  const [roomCode, setRoomCode] = useState(searchParams.get('code') || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [room, setRoom] = useState(null)
  const navigate = useNavigate()

  const handleSubmit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setRoom(null)
    try {
      const data = await joinRoom(roomId.trim(), roomCode.trim())
      setRoom(data)
      navigate('/connected', { state: { room: data } })
    } catch (err) {
      setError(err.message || 'Unable to join the room right now.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="landing">
      <Header />

      <main className="hero">
        <h1 className="hero-title">Join Room</h1>
        <p className="hero-subtitle">Enter the room ID and join code to connect.</p>

        <form className="join-form" onSubmit={handleSubmit}>
          <input
            className="text-input"
            type="text"
            name="roomId"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            required
          />
          <input
            className="text-input"
            type="text"
            name="roomCode"
            placeholder="Join Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            required
          />
          <div className="form-actions">
            <Button variant="primary" type="submit" loading={loading}>
              Join Room
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => navigate('/create')}
              disabled={loading}
            >
              Create New
            </Button>
          </div>
        </form>

        {error && <div className="status status-error">{error}</div>}
        {room && <div className="status status-success">Connected to room.</div>}

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

export default JoinRoomPage
