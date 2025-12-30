import { Header, Button, Footer } from '../../components'
import './Landing.css'

function Landing() {
  const handleCreateRoom = () => {
    console.log('Create Room clicked')
  }

  const handleJoinRoom = () => {
    console.log('Join Room clicked')
  }

  return (
    <div className="landing">
      <Header />
      
      <main className="hero">
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
