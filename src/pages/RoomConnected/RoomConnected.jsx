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
        <h1 className="hero-title">Room connected</h1>
        <p className="hero-subtitle">You are in. Share the link or QR to invite others.</p>

        {isCreator && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginBottom: '2rem' }}>
            <button
              className={`go-live-btn${goLiveLoading ? ' go-live-btn--loading' : ''}`}
              disabled={goLiveLoading}
              onClick={async () => {
                setGoLiveError('')
                // If already streaming, just navigate back to GoLive page
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
        )}

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
              )}

              {/* Participant View */}
              {!isCreator && (
                <div className="participant-sync-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <span style={{ fontWeight: '700', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717a' }}>Audio Sync</span>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={participantAudioEnabled}
                        onChange={(e) => setParticipantAudioEnabled(e.target.checked)}
                      />
                      <span className="slider round"></span>
                    </label>
                  </div>

                  {/* ── Live streaming indicator ── */}
                  <div className="live-stream-status">
                    <span className={`live-stream-dot ${participantAudioEnabled ? 'live-stream-dot--active' : ''}`} />
                    <span style={{ fontSize: '0.78rem', color: participantAudioEnabled ? '#a78bfa' : '#52525b' }}>
                      {participantAudioEnabled
                        ? 'Listening for live audio from host…'
                        : 'Enable toggle to hear live & synced audio'}
                    </span>
                  </div>

                  {currentFileName ? (
                    <div style={{ textAlign: 'center', marginTop: '0.75rem' }}>
                      <p style={{ marginBottom: '0.4rem', color: '#71717a', fontSize: '0.85rem' }}>Synced File:</p>
                      <p style={{ fontWeight: '700', color: '#a78bfa', fontSize: '0.95rem' }}>{currentFileName}</p>
                      <audio
                        ref={audioRef}
                        src={audioSrc}
                        muted={!participantAudioEnabled}
                      />
                    </div>
                  ) : (
                    <p style={{ fontStyle: 'italic', color: '#3f3f46', textAlign: 'center', fontSize: '0.88rem', marginTop: '0.75rem' }}>Waiting for host to play audio...</p>
                  )}
                </div>
              )}

              <div style={{ marginTop: '1rem', width: '100%' }}>
                <Button variant="secondary" onClick={handleLeave} style={{ width: '100%', borderColor: 'rgba(248,113,113,0.35)', color: '#f87171', background: 'rgba(248,113,113,0.08)' }}>
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
                  <li className="participant-item" style={{ color: '#999', fontStyle: 'italic' }}>Waiting for users...</li>
                )}
              </ul>
            </aside>
          </div>
        ) : (
          <div className="status status-error">Missing room info. Please re-join.</div>
        )}
      </main>

      {/* Video Popup Overlay */}
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
