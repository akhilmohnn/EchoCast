/**
 * media.js
 * -------------------------------------------------------------------
 * Tab audio capture helper.
 *
 * Uses navigator.mediaDevices.getDisplayMedia to capture the audio
 * from a browser tab. Video tracks are immediately stopped since
 * EchoCast only streams audio.
 *
 * Flow:
 *   captureTabAudio()
 *     → getDisplayMedia({ audio: true })
 *     → stop video tracks
 *     → validate audio track exists
 *     → return MediaStream (audio only)
 * -------------------------------------------------------------------
 */

/**
 * Capture tab audio via getDisplayMedia.
 * Chrome requires video:true in the constraint, but we immediately
 * discard video tracks — we only care about audio.
 *
 * @returns {Promise<MediaStream>} Audio-only MediaStream
 * @throws {Error} If no audio was shared or permission denied
 */
export async function captureTabAudio() {
    const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,   // Chrome requires video:true to show the tab picker
        audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            sampleRate: 48000,
        },
    })

    // Discard video tracks — EchoCast is audio-only
    mediaStream.getVideoTracks().forEach(t => t.stop())

    // Validate that audio was actually shared
    if (mediaStream.getAudioTracks().length === 0) {
        mediaStream.getTracks().forEach(t => t.stop())
        throw new Error('No audio was shared. Tick "Share tab audio" in the Chrome picker.')
    }

    return mediaStream
}
