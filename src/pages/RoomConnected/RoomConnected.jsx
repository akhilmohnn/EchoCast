import { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import {
  getParticipants,
  removeParticipant,
  getCurrentUserId,
  leaveRoom,
  onSignalingEvent,
  toggleParticipantMute,
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
  const [goLiveLoading, setGoLiveLoading] = useState(false)
  const [goLiveError, setGoLiveError] = useState('')
  const [showParticipantsList, setShowParticipantsList] = useState(false)

  const { isStreaming, startStream, stopStream } = useAudioStream()

  // ── LiveKit listener for slave devices ────────────────────────────
  const isCreatorResolved = currentUserId && room?.creatorId === currentUserId
  const isSlaveReady = currentUserId && !isCreatorResolved
  useLivekitListener(
    isSlaveReady ? room?.livekitUrl : null,
    isSlaveReady ? room?.livekitToken : null,
    participantAudioEnabled
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

    return () => {
      unsub1()
      unsub2()
      unsub3()
      unsub4()
      unsub5()
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
                <div className={`audio-orb-wrapper${participantAudioEnabled ? ' audio-orb-wrapper--active' : ''}`}>
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
