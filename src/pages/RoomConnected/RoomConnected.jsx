import { useEffect, useState, useRef, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import {
  getParticipants,
  removeParticipant,
  getCurrentUserId,
  leaveRoom,
  onSignalingEvent,
  toggleParticipantMute,
  updateSpatialVolumes,
} from '../../services/roomService'
import { useAudioStream } from '../../context/AudioStreamContext'
import { useLivekitListener } from '../../hooks/useLivekitListener'
import '../Landing/Landing.css'
import './RoomConnected.css'
import './Toggle.css'

function RoomConnectedPage() {
  const { state } = useLocation()
  const room = state?.room || state
  const navigate = useNavigate()

  const [participants, setParticipants] = useState([])
  const [mutedParticipants, setMutedParticipants] = useState(new Set())
  const [currentUserId, setCurrentUserId] = useState('')
  const [participantAudioEnabled, setParticipantAudioEnabled] = useState(false)
  const [spatialVolume, setSpatialVolume] = useState(1.0)
  const [goLiveLoading, setGoLiveLoading] = useState(false)
  const [goLiveError, setGoLiveError] = useState('')
  const [showParticipantsList, setShowParticipantsList] = useState(false)
  const [showSpatialMap, setShowSpatialMap] = useState(false)

  const { isStreaming, startStream, stopStream } = useAudioStream()

  // ── LiveKit listener for slave devices ────────────────────────────
  const isCreatorResolved = currentUserId && room?.creatorId === currentUserId
  const isSlaveReady = currentUserId && !isCreatorResolved
  useLivekitListener(
    isSlaveReady ? room?.livekitUrl : null,
    isSlaveReady ? room?.livekitToken : null,
    participantAudioEnabled,
    spatialVolume
  )

  useEffect(() => {
    setCurrentUserId(getCurrentUserId())
  }, [])

  // ── Real-time participant updates via WebSocket ────────────────────
  useEffect(() => {
    if (!room?.roomId) return

    // Initial fetch
    getParticipants(room.roomId)
      .then(users => {
        const unique = Array.from(new Map(users.map(u => [u.id, u])).values())
        setParticipants(unique)
      })
      .catch(err => console.error('Failed to fetch participants', err))

    // Listen for real-time updates
    const unsub1 = onSignalingEvent('participant_joined', (msg) => {
      if (msg.participants) {
        setParticipants(Array.from(new Map(msg.participants.map(u => [u.id, u])).values()))
      }
    })

    const unsub2 = onSignalingEvent('participant_left', (msg) => {
      if (msg.participants) {
        setParticipants(Array.from(new Map(msg.participants.map(u => [u.id, u])).values()))
      }
    })

    const unsub3 = onSignalingEvent('you_were_removed', () => {
      alert('You have been removed from the room.')
      navigate('/')
    })

    const unsub4 = onSignalingEvent('participant_mute_toggled', (msg) => {
      setMutedParticipants(prev => {
        const next = new Set(prev)
        if (msg.mute) next.add(msg.userId)
        else next.delete(msg.userId)
        return next
      })
    })

    const unsub5 = onSignalingEvent('admin_toggled_mute', (msg) => {
      setParticipantAudioEnabled(!msg.mute)
    })

    const unsub6 = onSignalingEvent('admin_set_volume', (msg) => {
      if (typeof msg.volume === 'number') {
        setSpatialVolume(msg.volume)
      }
    })

    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
      unsub5()
      unsub6()
    }
  }, [room?.roomId, navigate])

  const handleLeave = async () => {
    try {
      await leaveRoom(room.roomId, currentUserId)
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
        {/* ── MASTER (CREATOR) VIEW ── */}
        {isCreator ? (
          <>
            <h1 className="hero-title">Room connected</h1>
            <p className="hero-subtitle">You are in. Share the link or QR to invite others.</p>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
              <button
                className={`go-live-btn${goLiveLoading ? ' go-live-btn--loading' : ''}`}
                disabled={goLiveLoading}
                onClick={async () => {
                  setGoLiveError('')
                  if (isStreaming) {
                    navigate('/golive', { state: room })
                    return
                  }
                  setGoLiveLoading(true)
                  const result = await startStream(room?.roomId, room?.livekitUrl, room?.livekitToken)
                  setGoLiveLoading(false)
                  if (result.ok) {
                    navigate('/golive', { state: room })
                  } else if (result.error) {
                    setGoLiveError(result.error)
                  }
                }}
              >
                {goLiveLoading ? (
                  <>
                    <span className="go-live-spinner" />
                    Requesting audio…
                  </>
                ) : (
                  <>
                    <span className="go-live-dot" />
                    {isStreaming ? 'Back to Studio' : 'Go Live'}
                  </>
                )}
              </button>
              {goLiveError && (
                <p className="go-live-error">{goLiveError}</p>
              )}
            </div>

            {room ? (
              <div className="room-content-wrapper">
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
                    <Button variant="secondary" onClick={handleLeave} style={{ width: '100%', borderColor: 'rgba(248,113,113,0.35)', color: '#f87171', background: 'rgba(248,113,113,0.08)' }}>
                      Leave Room
                    </Button>
                  </div>
                </section>

                <aside className="participants-panel">
                  <div className="participants-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>Connections</span>
                      <span className="participants-count">{participants.length}</span>
                    </div>
                    <button 
                      onClick={() => setShowSpatialMap(!showSpatialMap)}
                      title="Spatial Audio Mixer"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                        fontSize: '1.5rem', animation: showSpatialMap ? 'pulse 2s infinite' : 'none',
                        transform: showSpatialMap ? 'scale(1.1)' : 'scale(1)', 
                        transition: 'all 0.2s', filter: showSpatialMap ? 'drop-shadow(0 0 8px rgba(59,130,246,0.6))' : 'none'
                      }}>
                      🌐
                    </button>
                  </div>
                  {showSpatialMap && (
                    <SpatialAudioMap 
                      participants={participants} 
                      roomId={room.roomId} 
                      currentUserId={currentUserId} 
                    />
                  )}
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
                        {user.id !== currentUserId && (
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              className="mute-btn"
                              title={mutedParticipants.has(user.id) ? "Unmute User" : "Mute User"}
                              onClick={() => toggleParticipantMute(room.roomId, user.id, !mutedParticipants.has(user.id))}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                color: mutedParticipants.has(user.id) ? '#ef4444' : '#9ca3af',
                                transition: 'color 0.2s',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                            >
                              {mutedParticipants.has(user.id) ? '🔇' : '🔊'}
                            </button>
                            <button
                              className="remove-btn"
                              title="Remove User"
                              onClick={() => handleRemoveUser(user)}
                            >
                              &times;
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                    {participants.length === 0 && (
                      <li className="participant-item" style={{ color: '#999', fontStyle: 'italic' }}>Waiting for users...</li>
                    )}
                  </ul>
                </aside>
              </div>
            ) : (
              <div className="status status-error">Missing room info. Please re-join.</div>
            )}
          </>
        ) : (
          /* ══════════════════════════════════════════════════════════
             ██  SLAVE (PARTICIPANT) VIEW – Immersive Audio Experience
             ══════════════════════════════════════════════════════════ */
          <>
            <h1 className="hero-title" style={{ fontSize: 'clamp(2rem, 6vw, 3.5rem)', marginBottom: '0.5rem' }}>
              Listening Room
            </h1>

            {room ? (
              <div className="slave-view">
                {/* Room header label */}
                <div className="slave-room-header">
                  <span className="slave-room-label">Connected to</span>
                  <div className="slave-room-name">{room.roomCode || room.roomId}</div>
                </div>

                {/* ── The Big Audio Orb ── */}
                <div className={`audio-orb-wrapper${participantAudioEnabled ? ' audio-orb-wrapper--active' : ''}`} style={{ opacity: participantAudioEnabled ? 0.3 + (spatialVolume * 0.7) : 1, transform: participantAudioEnabled ? `scale(${0.8 + (spatialVolume * 0.2)})` : 'scale(1)' }}>
                  <div className="audio-orb-ring audio-orb-ring--3" />
                  <div className="audio-orb-ring audio-orb-ring--2" />
                  <div className="audio-orb-ring audio-orb-ring--1" />

                  <button
                    className={`audio-orb-btn${participantAudioEnabled ? ' audio-orb-btn--active' : ''}`}
                    onClick={() => setParticipantAudioEnabled(prev => !prev)}
                    title={participantAudioEnabled ? 'Tap to mute' : 'Tap to listen'}
                  >
                    <div className="audio-orb-icon">
                      {participantAudioEnabled ? (
                        /* Volume On SVG */
                        <svg viewBox="0 0 24 24">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="currentColor" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      ) : (
                        /* Volume Off SVG */
                        <svg viewBox="0 0 24 24">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="currentColor" />
                          <line x1="23" y1="9" x2="17" y2="15" />
                          <line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      )}
                    </div>

                    {/* Sound wave bars */}
                    <div className="sound-wave-bars">
                      <div className="sound-wave-bar" style={{ height: '5px' }} />
                      <div className="sound-wave-bar" style={{ height: '10px' }} />
                      <div className="sound-wave-bar" style={{ height: '16px' }} />
                      <div className="sound-wave-bar" style={{ height: '10px' }} />
                      <div className="sound-wave-bar" style={{ height: '5px' }} />
                    </div>

                    <span className="audio-orb-label">
                      {participantAudioEnabled ? 'Listening' : 'Tap to Listen'}
                    </span>
                  </button>
                </div>

                {/* Status message */}
                <div className={`slave-status-msg${participantAudioEnabled ? ' slave-status-msg--active' : ''}`}>
                  {participantAudioEnabled ? (
                    <>
                      <strong>Audio Enabled</strong>
                      Syncing with host in real-time
                    </>
                  ) : (
                    <>
                      <strong>Audio Muted</strong>
                      Tap the orb above to start listening
                    </>
                  )}
                </div>

                {/* Bottom bar: Participants chip + Leave */}
                <div className="slave-bottom-bar">
                  <div className="slave-participants-chip" onClick={() => setShowParticipantsList(prev => !prev)} role="button" tabIndex={0}>
                    <svg className="slave-participants-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                    <span className="slave-participants-chip-count">{participants.length}</span>
                    <span className="slave-participants-chip-label">
                      {participants.length === 1 ? 'Participant' : 'Participants'}
                    </span>
                    <svg className={`slave-chip-chevron${showParticipantsList ? ' slave-chip-chevron--open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  <button className="slave-leave-btn" onClick={handleLeave}>
                    <svg className="slave-leave-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Leave Room
                  </button>
                </div>

                {/* Expandable participants roster */}
                <div className={`slave-roster${showParticipantsList ? ' slave-roster--open' : ''}`}>
                  <div className="slave-roster-inner">
                    <div className="slave-roster-header">
                      <span className="slave-roster-title">Who's Here</span>
                      <span className="slave-roster-badge">{participants.length}</span>
                    </div>
                    <ul className="slave-roster-list">
                      {participants.map((user, idx) => {
                        const hue = Math.abs((user.name || user.id).split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % 360
                        return (
                          <li key={`${user.id}-${idx}`} className="slave-roster-item">
                            <div className="slave-roster-avatar" style={{ background: `hsl(${hue}, 65%, 72%)` }}>
                              {(user.name || '?').charAt(0).toUpperCase()}
                            </div>
                            <div className="slave-roster-info">
                              <span className="slave-roster-name">
                                {user.name}{user.id === currentUserId && <span className="slave-roster-you">You</span>}
                              </span>
                              <span className="slave-roster-role">
                                {user.id === room?.creatorId ? 'Host' : 'Listener'}
                              </span>
                            </div>
                            <span className={`slave-roster-dot${user.id === room?.creatorId ? ' slave-roster-dot--host' : ''}`} />
                          </li>
                        )
                      })}
                      {participants.length === 0 && (
                        <li className="slave-roster-item slave-roster-empty">No one else here yet…</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <div className="status status-error">Missing room info. Please re-join.</div>
            )}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

export default RoomConnectedPage

function SpatialAudioMap({ participants, roomId, currentUserId }) {
  const containerRef = useRef(null)
  const listeners = participants.filter(p => p.id !== currentUserId)
  
  const radius = 100
  const center = 150
  
  const listenerCoords = useMemo(() => {
    const coords = {}
    listeners.forEach((p, i) => {
      const angle = (i / listeners.length) * 2 * Math.PI
      coords[p.id] = {
        x: center + radius * Math.cos(angle),
        y: center + radius * Math.sin(angle)
      }
    })
    return coords
  }, [listeners])

  const [dotPos, setDotPos] = useState({ x: center, y: center })
  const isDragging = useRef(false)
  const lastUpdateRef = useRef(0)

  const handlePointerDown = (e) => {
    isDragging.current = true
    updatePos(e)
    e.target.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!isDragging.current) return
    updatePos(e)
  }

  const handlePointerUp = (e) => {
    isDragging.current = false
    e.target.releasePointerCapture(e.pointerId)
  }

  const updatePos = (e) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let x = e.clientX - rect.left
    let y = e.clientY - rect.top
    
    x = Math.max(0, Math.min(300, x))
    y = Math.max(0, Math.min(300, y))
    setDotPos({ x, y })

    const now = Date.now()
    if (now - lastUpdateRef.current > 100) {
      calculateAndSendVolumes(x, y)
      lastUpdateRef.current = now
    }
  }

  const calculateAndSendVolumes = (x, y) => {
    if (listeners.length === 0) return
    const volumes = {}
    const MAX_DIST = 160 
    
    Object.entries(listenerCoords).forEach(([id, coord]) => {
      const dist = Math.sqrt(Math.pow(x - coord.x, 2) + Math.pow(y - coord.y, 2))
      let vol = 1.0 - (dist / MAX_DIST)
      vol = Math.max(0.1, Math.min(1.0, vol))
      volumes[id] = Number(vol.toFixed(2))
    })

    updateSpatialVolumes(roomId, volumes)
  }

  return (
    <div style={{ margin: '1rem 0', background: 'rgba(31,41,55,0.8)', borderRadius: '16px', padding: '1.5rem 1rem', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1rem', margin: 0, color: '#f3f4f6', fontWeight: '600' }}>Spatial Mixer</h3>
      </div>
      <div 
        ref={containerRef}
        style={{ 
          width: 300, 
          height: 300, 
          background: 'radial-gradient(circle at center, #2a2a2a 0%, #050505 100%)', 
          borderRadius: '50%', 
          margin: '0 auto', 
          position: 'relative',
          touchAction: 'none',
          border: '2px solid rgba(255,255,255,0.2)',
          boxShadow: 'inset 0 0 40px rgba(0,0,0,0.8)',
          cursor: 'grab'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Center Guide */}
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
        
        {/* Listeners */}
        {Object.entries(listenerCoords).map(([id, coord]) => {
          const user = listeners.find(l => l.id === id)
          const dist = Math.sqrt(Math.pow(dotPos.x - coord.x, 2) + Math.pow(dotPos.y - coord.y, 2))
          let vol = 1.0 - (dist / 160)
          vol = Math.max(0.1, Math.min(1.0, vol))
          
          return (
            <div 
              key={id}
              style={{
                position: 'absolute',
                left: coord.x,
                top: coord.y,
                transform: `translate(-50%, -50%) scale(${0.8 + (vol * 0.4)})`,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#333333',
                border: '1px solid #777777',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontWeight: 'bold',
                pointerEvents: 'none',
                boxShadow: `0 0 ${15 * vol}px rgba(255,255,255,${vol * 0.4})`,
                transition: 'transform 0.1s ease-out, box-shadow 0.1s ease-out',
                zIndex: 1
              }}
              title={user?.name}
            >
              {(user?.name || '?').charAt(0).toUpperCase()}
            </div>
          )
        })}
        
        {/* Playhead Dot */}
        <div 
          style={{
            position: 'absolute',
            left: dotPos.x,
            top: dotPos.y,
            transform: 'translate(-50%, -50%) scale(1)',
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 0 20px 4px rgba(255,255,255,0.6)',
            pointerEvents: 'none',
            zIndex: 10
          }}
        />
      </div>
      <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#9ca3af', marginTop: '1.5rem', marginBottom: 0 }}>
        Drag the blue orb to mix audio spatially.
      </p>
    </div>
  )
}
