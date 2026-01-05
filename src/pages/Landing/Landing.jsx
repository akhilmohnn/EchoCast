import { useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import './Landing.css'

function Landing() {
  const navigate = useNavigate()

  const handleCreateRoom = () => {
    navigate('/create')
  }

  const handleJoinRoom = () => {
    navigate('/join')
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
          <Button variant="primary" onClick={handleCreateRoom}>
            Create Room
          </Button>
          <Button variant="secondary" onClick={handleJoinRoom}>
            Join Room
          </Button>
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default Landing
