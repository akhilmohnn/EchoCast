import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import { getParticipants, removeParticipant, getCurrentUserId } from '../../services/roomService'
import '../Landing/Landing.css'
import './RoomConnected.css'

function RoomConnectedPage() {
  const { state } = useLocation()
  const room = state?.room || state // allow both shapes
  const navigate = useNavigate()
  
  const [participants, setParticipants] = useState([])
  const [currentUserId, setCurrentUserId] = useState('')

  useEffect(() => {
    setCurrentUserId(getCurrentUserId())
  }, [])

  useEffect(() => {
    if (!room?.roomId) return
    
    // Poll for participants
    const fetchParticipants = async () => {
      try {
        const users = await getParticipants(room.roomId)
        // Deduplicate based on ID if possible, otherwise simple set for strings
        // Since we now store objects, dedupe by ID
        const unique = Array.from(new Map(users.map(u => [u.id, u])).values())
        setParticipants(unique)

        // Check if I am still in the room
        const myId = getCurrentUserId()
        const amIStillThere = unique.some(u => u.id === myId)
        if (!amIStillThere) {
          alert('You have been disconnected from the room.')
          navigate('/')
        }
      } catch (err) {
        console.error('Failed to fetch participants', err)
      }
    }

    fetchParticipants()
    const interval = setInterval(fetchParticipants, 3000)
    return () => clearInterval(interval)
  }, [room?.roomId])

  const handleLeave = async () => {
     try {
       const user = participants.find(p => p.id === currentUserId)
       if (user) {
         await removeParticipant(room.roomId, user)
       }
       navigate('/')
     } catch (err) {
       console.error('Error leaving room', err)
       navigate('/')
     }
  }

  const handleRemoveUser = async (userToRemove) => {
    if (!window.confirm(`Are you sure you want to remove ${userToRemove.name}?`)) return
    try {
      await removeParticipant(room.roomId, userToRemove)
      // Optimistic update
      setParticipants(prev => prev.filter(p => p.id !== userToRemove.id))
    } catch (err) {
      console.error('Failed to remove user', err)
      alert('Failed to remove user')
    }
  }

  const isCreator = room?.creatorId === currentUserId

  return (
    <div className="landing">
      <Header />

      <main className="hero">
        <h1 className="hero-title">Room connected</h1>
        <p className="hero-subtitle">You are in. Share the link or QR to invite others.</p>

        {room ? (
          <div className="room-content-wrapper">
             {/* Left side: Room info */}
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
                {room.isCreator && <div className="meta-item"><span className="meta-label">Role</span><span className="meta-value">Creator</span></div>}
              </div>
              <div className="qr-block">
                <img src={room.qrDataUrl} alt="Room QR code" className="qr-image" />
                <p className="qr-caption">Scan to join the room</p>
              </div>
              <div style={{ marginTop: '1rem', width: '100%' }}>
                  <Button variant="secondary" onClick={handleLeave} style={{ width: '100%', borderColor: '#ff4d4f', color: '#ff4d4f' }}>
                    Leave Room
                  </Button>
              </div>
            </section>

             {/* Right side: Participants */}
             <aside className="participants-panel">
               <div className="participants-title">
                 <span>Connections</span>
                 <span className="participants-count">{participants.length}</span>
               </div>
               <ul className="participants-list">
                 {participants.map((user, idx) => (
                   <li key={`${user.id}-${idx}`} className="participant-item">
                     <div 
                        className="participant-avatar" 
                        style={{
                            backgroundColor: `hsl(${Math.abs((user.name || user.id).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) % 360}, 70%, 80%)`, 
                            border: 'none',
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                            fontWeight: 'bold',
                            color: '#555'
                        }}
                     >
                       {(user.name || '?').charAt(0).toUpperCase()}
                     </div>
                     <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontWeight: user.id === currentUserId ? 'bold' : 'normal' }}>
                            {user.name} {user.id === currentUserId && '(You)'}
                        </span>
                     </div>
                     {isCreator && user.id !== currentUserId && (
                         <button 
                            className="remove-btn" 
                            title="Remove User"
                            onClick={() => handleRemoveUser(user)}
                         >
                             &times;
                         </button>
                     )}
                   </li>
                 ))}
                 {participants.length === 0 && (
                     <li className="participant-item" style={{color: '#999', fontStyle: 'italic'}}>Waiting for users...</li>
                 )}
               </ul>
             </aside>
          </div>
        ) : (
          <div className="status status-error">Missing room info. Please re-join.</div>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default RoomConnectedPage
