import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import '../Landing/Landing.css'
import { createRoom } from '../../services/roomService'

function CreateRoomPage() {
  const [userName, setUserName] = useState('')
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const generateRoom = async (e) => {
    if (e) e.preventDefault()
    if (!userName.trim()) {
      setError('Please enter your name.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const data = await createRoom(userName)
      navigate('/connected', { state: { room: data } })
    } catch (err) {
      setRoom(null)
      setError(err.message || 'Unable to create room right now.')
    } finally {
      setLoading(false)
    }
  }

  // Removed useEffect to auto-generate, user must input name first
  // useEffect(() => {
  //   generateRoom()
  // }, [])

  return (
    <div className="landing">
      <Header />

      <main className="hero">
        <h1 className="hero-title">Create Room</h1>
        <p className="hero-subtitle">Generate a room ID, code, and QR for quick sharing.</p>

        <form onSubmit={generateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
           <input
            className="text-input"
            type="text"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            required
            style={{ minWidth: '300px' }}
          />

          <div className="button-group">
            <Button variant="primary" type="submit" loading={loading}>
              Generate New Room
            </Button>
            <Button
              variant="secondary"
              type="button"
              onClick={() => navigate('/join')}
              disabled={loading}
            >
              Go to Join
            </Button>
          </div>
        </form>

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
