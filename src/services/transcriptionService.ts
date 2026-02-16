import { executeGraphQL } from './appsyncClient'
import { TRANSCRIBE_AUDIO_MUTATION } from '../graphql/operations'
import type { TranscribeAudioInput, TranscriptionResult } from '../graphql/operations'

interface TranscribeAudioResponse {
  transcribeAudio: TranscriptionResult
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  const input: TranscribeAudioInput = {
    audio: audioBase64,
    mimeType,
  }

  const data = await executeGraphQL<TranscribeAudioResponse>(
    TRANSCRIBE_AUDIO_MUTATION,
    { input }
  )

  const text = data.transcribeAudio.text
  if (!text || text.trim().length === 0) {
    throw new Error('No speech detected. Please try again.')
  }

  return text
}
