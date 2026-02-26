import { useEffect, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Header, Button, Footer } from '../../components'
import { getParticipants, removeParticipant, getCurrentUserId, updateAudioState, getAudioState, uploadAudioChunked, downloadAudioChunked } from '../../services/roomService'
import { useAudioStream } from '../../context/AudioStreamContext'
import { useLiveAudioPlayer } from '../../hooks/useLiveAudioPlayer'
import '../Landing/Landing.css'
import './RoomConnected.css'
import './Toggle.css'
import { extractAndDownmixAudio } from '../../services/audioUtils'

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
  const [isVideoPopupOpen, setIsVideoPopupOpen] = useState(false)
  const [mediaType, setMediaType] = useState('audio') // 'audio' or 'video'
  const [localMediaSrc, setLocalMediaSrc] = useState(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [goLiveLoading, setGoLiveLoading] = useState(false)
  const [goLiveError, setGoLiveError] = useState('')
  const [showParticipantsList, setShowParticipantsList] = useState(false)

  const { isStreaming, startStream, stopStream } = useAudioStream()

  // ── Live audio player for slave devices ──────────────────────────
  // Only activate once we've confirmed the userId and know we're NOT the creator.
  // currentUserId is '' on first render; don't pass roomId until it's resolved.
  const isCreatorResolved = currentUserId && room?.creatorId === currentUserId
  const isSlaveReady = currentUserId && !isCreatorResolved
  useLiveAudioPlayer(
    isSlaveReady ? room?.roomId : null,
    participantAudioEnabled
  )

  const fileInputRef = useRef(null)
  const videoInputRef = useRef(null)
  const audioRef = useRef(null)
  const videoRef = useRef(null)

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

          const lastSync = Number(audio.dataset.lastSyncId || 0);
          const stateChanged = (lastSync !== audioState.timestamp);
          const duration = audio.duration || Infinity;

          if (stateChanged) {
            // New explicit event from host OR we just joined the room
            audio.dataset.lastSyncId = audioState.timestamp;

            let targetPosition = audioState.position;
            if (audioState.status === 'playing') {
              // Calculate how long it's been since the host fired this event
              // If their clocks are out of sync, this might be slightly off, but it prevents the stutter loop completely!
              const elapsedSeconds = (Date.now() - audioState.timestamp) / 1000;
              targetPosition += Math.max(0, elapsedSeconds);
            }
            if (targetPosition > duration) targetPosition = duration;

            // Only seek once per explicit host event
            if (Math.abs(audio.currentTime - targetPosition) > 0.2) {
              audio.currentTime = targetPosition;
            }

            if (audioState.status === 'playing' && targetPosition < duration) {
              if (participantAudioEnabled) {
                await audio.play().catch(e => console.warn('Autoplay blocked', e));
              }
            } else {
              audio.pause();
            }
          } else {
            // No new event: let the browser play normally without ANY continuous mathematical polling/drift interpolation!
            // Just ensure playback state matches in case autoplay was previously blocked and user just enabled it.
            if (audioState.status === 'playing' && audio.paused && audio.currentTime < duration) {
              if (participantAudioEnabled) {
                await audio.play().catch(e => console.warn('Autoplay blocked', e));
              }
            } else if ((audioState.status === 'paused' || audio.currentTime >= duration) && !audio.paused) {
              audio.pause();
            }
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

  const handleVideoUploadClick = () => {
    videoInputRef.current?.click()
  }

  const handleFileChange = async (e, type) => {
    const file = e.target.files?.[0]
    // Reset the input so the same or a different file can be selected again later
    e.target.value = ''
    if (!file) return

    if (localMediaSrc) URL.revokeObjectURL(localMediaSrc)
    if (audioSrc && audioSrc.startsWith('blob:')) URL.revokeObjectURL(audioSrc)

    setCurrentFileName(file.name)
    setMediaType(type)

    if (type === 'video') {
      const localUrl = URL.createObjectURL(file)
      setLocalMediaSrc(localUrl)
      setAudioSrc(null)
      setIsVideoPopupOpen(true)

      try {
        setIsExtracting(true)
        const audioDataUrl = await extractAndDownmixAudio(file)
        setAudioSrc(audioDataUrl)

        await uploadAudioChunked(room.roomId, audioDataUrl)
        const newVersion = Date.now()
        setCurrentFileVersion(newVersion)

        await updateAudioState(room.roomId, {
          fileVersion: newVersion,
          fileName: file.name,
          status: 'paused',
          position: 0,
          timestamp: Date.now()
        })
      } catch (err) {
        console.error('Audio extraction failed', err)
        alert('Failed to process video audio.')
      } finally {
        setIsExtracting(false)
      }
    } else {
      const localUrl = URL.createObjectURL(file)
      setLocalMediaSrc(localUrl)

      const reader = new FileReader()
      reader.onload = async (evt) => {
        const dataUrl = evt.target.result
        setAudioSrc(dataUrl)

        try {
          await uploadAudioChunked(room.roomId, dataUrl)
          const newVersion = Date.now()
          setCurrentFileVersion(newVersion)
          await updateAudioState(room.roomId, {
            fileVersion: newVersion,
            fileName: file.name,
            status: 'paused',
            position: 0,
            timestamp: Date.now()
          })
        } catch (err) {
          console.error('Upload failed', err)
          alert('Failed to upload file')
        }
      }
      reader.readAsDataURL(file)
    }
  }

  const handleMasterPlay = () => {
    const activeRef = mediaType === 'video' ? videoRef.current : audioRef.current
    if (activeRef) {
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion, // maintain current version
        fileName: currentFileName,
        status: 'playing',
        position: activeRef.currentTime,
        timestamp: Date.now()
      })
    }
  }

  const handleMasterPause = () => {
    const activeRef = mediaType === 'video' ? videoRef.current : audioRef.current
    if (activeRef) {
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion, // maintain current version
        fileName: currentFileName,
        status: 'paused',
        position: activeRef.currentTime,
        timestamp: Date.now()
      })
    }
  }

  const handleMasterSeek = () => {
    const activeRef = mediaType === 'video' ? videoRef.current : audioRef.current
    if (activeRef) {
      // Determine status (playing or paused)
      const status = activeRef.paused ? 'paused' : 'playing'
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion, // maintain current version
        fileName: currentFileName,
        status: status,
        position: activeRef.currentTime,
        timestamp: Date.now()
      })
    }
  }

  const handleCloseVideoPopup = () => {
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
      updateAudioState(room.roomId, {
        fileVersion: currentFileVersion,
        fileName: currentFileName,
        status: 'paused',
        position: videoRef.current.currentTime,
        timestamp: Date.now()
      })
    }
    setIsVideoPopupOpen(false)
  }

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
                  const ok = await startStream(room?.roomId)
                  setGoLiveLoading(false)
                  if (ok) {
                    navigate('/golive', { state: room })
                  } else {
                    setGoLiveError('Could not start stream. Select a tab and make sure to tick "Share tab audio" in the Chrome picker.')
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

                  <div className="master-controls">
                    <input
                      type="file"
                      accept="audio/mp3,audio/*"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={(e) => handleFileChange(e, 'audio')}
                    />
                    <input
                      type="file"
                      accept="video/mp4,video/*"
                      ref={videoInputRef}
                      style={{ display: 'none' }}
                      onChange={(e) => handleFileChange(e, 'video')}
                    />
                    <Button variant="primary" style={{ width: '100%' }} onClick={handleAudioUploadClick}>
                      Upload Audio
                    </Button>
                    {(localMediaSrc || audioSrc) && mediaType === 'audio' && (
                      <div className="audio-player-wrapper">
                        <p className="file-name">Playing: {currentFileName}</p>
                        <audio
                          ref={audioRef}
                          controls
                          src={localMediaSrc || audioSrc}
                          onPlay={handleMasterPlay}
                          onPause={handleMasterPause}
                          onSeeked={handleMasterSeek}
                          onEnded={handleMasterPause}
                        />
                      </div>
                    )}
                    <Button variant="primary" style={{ width: '100%' }} onClick={handleVideoUploadClick}>
                      Upload Video
                    </Button>
                    {mediaType === 'video' && (localMediaSrc || audioSrc) && !isVideoPopupOpen && (
                      <Button variant="secondary" style={{ width: '100%' }} onClick={() => setIsVideoPopupOpen(true)}>
                        Open Video Player
                      </Button>
                    )}
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

                {/* Synced file indicator */}
                {currentFileName ? (
                  <div className="slave-synced-file">
                    <svg className="slave-synced-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    <span className="slave-synced-file-name">{currentFileName}</span>
                  </div>
                ) : (
                  <span className="slave-waiting-text">Waiting for host to play audio…</span>
                )}

                {/* Hidden audio element for sync */}
                <audio
                  ref={audioRef}
                  src={audioSrc}
                  muted={!participantAudioEnabled}
                  style={{ display: 'none' }}
                />

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

      {/* Video Popup Overlay (Master only) */}
      {isVideoPopupOpen && (localMediaSrc || audioSrc) && mediaType === 'video' && (
        <div className="video-popup-overlay">
          <div className="video-popup-content">
            <div className="video-popup-header">
              <span className="file-name">Playing: {currentFileName}</span>
              {isExtracting && <span style={{ color: '#ffeb3b', fontSize: '0.85rem' }}>Processing audio for participants...</span>}
              <button className="close-popup-btn" onClick={handleCloseVideoPopup}>×</button>
            </div>
            <video
              ref={videoRef}
              controls
              src={localMediaSrc || audioSrc}
              className="video-player"
              onPlay={handleMasterPlay}
              onPause={handleMasterPause}
              onSeeked={handleMasterSeek}
              onEnded={handleMasterPause}
            />
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}

export default RoomConnectedPage
