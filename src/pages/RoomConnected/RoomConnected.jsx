import { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import { getParticipants, removeParticipant, getCurrentUserId, updateAudioState, getAudioState, uploadAudioChunked, downloadAudioChunked } from '../../services/roomService'
import '../Landing/Landing.css'
import './RoomConnected.css'
import './Toggle.css'

function RoomConnectedPage() {
  const { state } = useLocation()
  const room = state?.room || state // allow both shapes
  const navigate = useNavigate()
  
  const [participants, setParticipants] = useState([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [audioSrc, setAudioSrc] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentFileName, setCurrentFileName] = useState('')
  const [currentFileVersion, setCurrentFileVersion] = useState(0)
  const [participantAudioEnabled, setParticipantAudioEnabled] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const fileInputRef = useRef(null)
  const audioRef = useRef(null)

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

  // Audio Sync Logic (Polling for participants, Event pushing for master)
  useEffect(() => {
    if (!room?.roomId) return
    const isCreator = room?.creatorId === currentUserId

    // Ref to track if we are currently handling a scheduled sync to avoid loops
    let isSyncing = false

    const syncAudio = async () => {
      if (isCreator) return // Master pushes state, doesn't poll it

      try {
        const audioState = await getAudioState(room.roomId)
        if (!audioState) return
        
        // Update file if changed via version check
        if (audioState.fileVersion && audioState.fileVersion !== currentFileVersion && !isDownloading) {
             setIsDownloading(true)
             // Download chunked file
             try {
                const dataUrl = await downloadAudioChunked(room.roomId)
                if (dataUrl) {
                    setAudioSrc(dataUrl)
                    setCurrentFileName(audioState.fileName)
                    setCurrentFileVersion(audioState.fileVersion)
                }
             } catch (e) {
                 console.error('Download failed', e)
             } finally {
                 setIsDownloading(false)
             }
        }

        if (audioRef.current && audioSrc) {
          const audio = audioRef.current
          isSyncing = true
          
          // Sync Play/Pause
          if (audioState.status === 'playing' && audio.paused) {
             if (participantAudioEnabled) {
                 await audio.play().catch(e => console.warn('Autoplay blocked', e))
             }
          } else if (audioState.status === 'paused' && !audio.paused) {
             audio.pause()
          }

          // Sync Time (Drift Correction)
          const serverTime = audioState.timestamp
          const clientTime = Date.now()
          const latency = (clientTime - serverTime) / 1000 
          // If status is playing, expected time is position + latency
          // If status is paused, expected time is position
          let expectedTime = audioState.position
          if (audioState.status === 'playing') {
             expectedTime += latency
          }

          if (Math.abs(audio.currentTime - expectedTime) > 0.5) {
             // Only seek if drift > 0.5s to avoid stutter
             audio.currentTime = expectedTime
          }
           isSyncing = false
        }

      } catch (err) {
        console.error('Audio sync error', err)
      }
    }
  
    const interval = setInterval(syncAudio, 1000) // Poll every second for audio
    return () => clearInterval(interval)
  }, [room?.roomId, currentUserId, audioSrc, participantAudioEnabled, currentFileVersion, isDownloading])

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
  
  const handleAudioUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) {
      if (audioSrc) URL.revokeObjectURL(audioSrc)
      
      const reader = new FileReader()
      reader.onload = async (evt) => {
        const dataUrl = evt.target.result
        setAudioSrc(dataUrl)
        setCurrentFileName(file.name)
        
        try {
            // Upload data chunked
            await uploadAudioChunked(room.roomId, dataUrl)

            const newVersion = Date.now()
            setCurrentFileVersion(newVersion)

            // Initial sync state update with versioning
            await updateAudioState(room.roomId, {
                // src: dataUrl, // We no longer send the huge src in state
                fileVersion: newVersion, // New version ID
                fileName: file.name,
                status: 'paused',
                position: 0,
                timestamp: Date.now()
            })
        } catch (err) {
            console.error('Upload failed', err)
            alert('Failed to upload audio file')
        }
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleMasterPlay = () => {
    if (audioRef.current) {
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion, // maintain current version
        fileName: currentFileName,
        status: 'playing',
        position: audioRef.current.currentTime,
        timestamp: Date.now()
      })
    }
  }

  const handleMasterPause = () => {
    if (audioRef.current) {
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion, // maintain current version
        fileName: currentFileName,
        status: 'paused',
        position: audioRef.current.currentTime,
        timestamp: Date.now()
      })
    }
  }

  const handleMasterSeek = () => {
    if (audioRef.current) {
        // Determine status (playing or paused)
        const status = audioRef.current.paused ? 'paused' : 'playing'
        updateAudioState(room.roomId, {
          fileVersion: currentFileVersion, // maintain current version
          fileName: currentFileName,
          status: status,
          position: audioRef.current.currentTime,
          timestamp: Date.now()
        })
    }
  }

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

              {/* Master Controls */}
              {isCreator && (
                <div style={{ marginTop: '1.5rem', width: '100%', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                   <input
                    type="file"
                    accept="audio/mp3,audio/*"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <Button variant="primary" style={{ width: '100%' }} onClick={handleAudioUploadClick}>
                    Upload Audio
                  </Button>
                  {audioSrc && (
                    <div className="audio-player-wrapper" style={{ width: '100%', marginTop: '0.5rem' }}>
                       <p className="file-name" style={{fontSize: '0.9rem', marginBottom: '0.5rem', fontWeight: 'bold'}}>
                          Playing: {currentFileName}
                       </p>
                       <audio 
                         ref={audioRef}
                         controls 
                         src={audioSrc} 
                         style={{ width: '100%' }} 
                         onPlay={handleMasterPlay}
                         onPause={handleMasterPause}
                         onSeeked={handleMasterSeek}
                       />
                    </div>
                  )}
                  <Button variant="primary" style={{ width: '100%' }} onClick={() => console.log('Upload Video')}>
                    Upload Video
                  </Button>
                </div>
              )}
              
              {/* Participant View */}
              {!isCreator && (
                 <div style={{ marginTop: '1.5rem', width: '100%', padding: '1rem', background: '#f0f0f0', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <span style={{ fontWeight: 'bold' }}>Audio Sync</span>
                      <label className="switch">
                        <input 
                          type="checkbox" 
                          checked={participantAudioEnabled} 
                          onChange={(e) => setParticipantAudioEnabled(e.target.checked)} 
                        />
                        <span className="slider round"></span>
                      </label>
                    </div>
                    
                    {currentFileName ? (
                        <div style={{textAlign: 'center'}}>
                            <p style={{marginBottom: '0.5rem'}}>Now Playing:</p>
                            <p style={{fontWeight: 'bold', color: '#0070f3'}}>{currentFileName}</p>
                            
                            {/* Hidden audio for participant, or simplified without controls if preferred, but user said "No controls on participant system" */}
                            <audio 
                                ref={audioRef}
                                src={audioSrc}
                                muted={!participantAudioEnabled} // Double safety
                            />
                             {!participantAudioEnabled && <p style={{fontSize:'0.8rem', color: '#666', marginTop:'0.5rem'}}>Enable toggle to hear sound</p>}
                        </div>
                    ) : (
                        <p style={{ fontStyle: 'italic', color: '#666', textAlign: 'center' }}>Waiting for host to play audio...</p>
                    )}
                 </div>
              )}

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
