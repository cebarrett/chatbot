import { useState, useRef, useCallback, useEffect } from 'react'
import { transcribeAudio } from '../services/transcriptionService'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

export interface UseVoiceRecorderReturn {
  state: RecordingState
  duration: number
  startRecording: () => void
  stopRecording: () => void
  transcript: string | null
  error: string | null
  isSupported: boolean
  clearTranscript: () => void
  clearError: () => void
}

const MAX_DURATION_SECONDS = 120

/**
 * Detect the best supported MIME type for MediaRecorder.
 * Safari doesn't support WebM, so we fall back to MP4.
 */
function getSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
  ]

  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }

  return null
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)
  const mimeTypeRef = useRef<string | null>(null)

  const isSupported = typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices !== 'undefined'
    && typeof navigator.mediaDevices.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined'
    && getSupportedMimeType() !== null

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    chunksRef.current = []
  }, [])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return

    setError(null)
    setTranscript(null)

    const mimeType = getSupportedMimeType()
    if (!mimeType) {
      setError('Microphone not available on this device.')
      return
    }
    mimeTypeRef.current = mimeType

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone access denied. Check your browser permissions.')
      } else {
        setError('Microphone not available on this device.')
      }
      return
    }

    streamRef.current = stream
    chunksRef.current = []

    const recorder = new MediaRecorder(stream, { mimeType })
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    recorder.onerror = () => {
      setError('Recording failed. Please try again.')
      cleanup()
      setState('idle')
    }

    recorder.start(1000) // Collect data every second
    startTimeRef.current = Date.now()
    setDuration(0)
    setState('recording')

    // Duration timer
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000)
      setDuration(elapsed)
      if (elapsed >= MAX_DURATION_SECONDS) {
        // Auto-stop at max duration — use the stopRecording logic inline
        // to avoid stale closure issues
        recorder.stop()
      }
    }, 500)

    // Handle auto-stop from max duration
    recorder.onstop = async () => {
      // Stop timer and release mic
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }

      const elapsedSeconds = (Date.now() - startTimeRef.current) / 1000
      if (elapsedSeconds < 1) {
        setError('Recording too short. Please speak for at least 1 second.')
        setState('idle')
        return
      }

      const audioBlob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []

      if (audioBlob.size === 0) {
        setError('No audio recorded. Please try again.')
        setState('idle')
        return
      }

      setState('transcribing')

      try {
        // Convert to base64
        const arrayBuffer = await audioBlob.arrayBuffer()
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        const base64 = btoa(binary)

        const text = await transcribeAudio(base64, mimeType)
        setTranscript(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transcription failed. Please try again.'
        setError(message)
      } finally {
        setState('idle')
      }
    }
  }, [state, cleanup])

  const stopRecording = useCallback(() => {
    if (state !== 'recording') return
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
      // The onstop handler takes over from here
    }
  }, [state])

  const clearTranscript = useCallback(() => {
    setTranscript(null)
  }, [])

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  return {
    state,
    duration,
    startRecording,
    stopRecording,
    transcript,
    error,
    isSupported,
    clearTranscript,
    clearError,
  }
}
