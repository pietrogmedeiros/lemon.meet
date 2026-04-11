import Groq, { toFile } from 'groq-sdk';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export interface TranscriptChunk {
  text: string;
  timestamp: Date;
  duration?: number;
  language?: string;
  startSeconds?: number; // segundos relativos ao início do chunk
  endSeconds?: number;   // segundos relativos ao início do chunk
}

export class TranscriptionService {
  /**
   * Transcreve um arquivo de áudio usando OpenAI Whisper
   */
  async transcribeAudio(audioFilePath: string): Promise<TranscriptChunk[]> {
    try {
      logger.info(`Starting transcription for file: ${audioFilePath}`);

      // Verifica se arquivo existe
      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }

      // Usa toFile() para garantir nome e tipo corretos para o Groq
      const audioStream = fs.createReadStream(audioFilePath);
      const audioFile = await toFile(audioStream, 'audio.webm', { type: 'audio/webm' });

      // Envia para Groq Whisper (whisper-large-v3-turbo — mais rápido e barato)
      const response = await groq.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3-turbo',
        language: 'pt',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });

      logger.info(`Transcription completed: ${response.text.length} characters`);

      // Converte resposta verbose em chunks
      const chunks: TranscriptChunk[] = [];
      // Cast para any: verbose_json retorna segments/language mas o tipo SDK não os declara
      const verboseResponse = response as any;

      // Limiar de probabilidade de não-fala — segmentos acima disso são alucinações do Whisper
      const NO_SPEECH_THRESHOLD = 0.6;

      if (verboseResponse.segments && Array.isArray(verboseResponse.segments)) {
        for (const segment of verboseResponse.segments) {
          // Filtra segmentos provavelmente sem fala (alucinações do Whisper)
          const noSpeechProb = segment.no_speech_prob ?? 0;
          if (noSpeechProb > NO_SPEECH_THRESHOLD) {
            logger.debug(`Seg descartado (no_speech_prob=${noSpeechProb.toFixed(2)}): "${segment.text.trim()}"`);
            continue;
          }
          const text = segment.text.trim();
          if (!text) continue;
          chunks.push({
            text,
            timestamp: new Date(Date.now() + (segment.start || 0) * 1000),
            duration: (segment.end || 0) - (segment.start || 0),
            language: verboseResponse.language ?? 'pt',
            startSeconds: segment.start ?? 0,
            endSeconds: segment.end ?? 0,
          });
        }
      } else if (response.text.trim()) {
        chunks.push({
          text: response.text.trim(),
          timestamp: new Date(),
          language: verboseResponse.language ?? 'pt',
          startSeconds: 0,
          endSeconds: 0,
        });
      }

      return chunks;

    } catch (error: any) {
      logger.error('Error transcribing audio:', error);
      throw error;
    }
  }

  /**
   * Transcreve um chunk de áudio em buffer
   */
  async transcribeBuffer(audioBuffer: Buffer, meetingId: string): Promise<TranscriptChunk[]> {
    try {
      // Salva buffer temporariamente
      const tempDir = path.join(process.cwd(), 'temp', 'chunks');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFile = path.join(tempDir, `${meetingId}-${Date.now()}.webm`);
      fs.writeFileSync(tempFile, audioBuffer);

      // Transcreve
      const chunks = await this.transcribeAudio(tempFile);

      // Remove arquivo temporário
      fs.unlinkSync(tempFile);

      return chunks;

    } catch (error) {
      logger.error('Error transcribing buffer:', error);
      throw error;
    }
  }

  /**
   * Transcreve áudio em tempo real (batching)
   * Processa chunks acumulados a cada intervalo
   */
  async transcribeRealtime(
    audioChunks: Buffer[],
    meetingId: string
  ): Promise<TranscriptChunk[]> {
    try {
      // Combina todos os chunks em um único buffer
      const combinedBuffer = Buffer.concat(audioChunks);

      // Verifica tamanho mínimo (evita transcrever silêncio)
      if (combinedBuffer.length < 1024) {
        logger.debug('Audio chunk too small, skipping transcription');
        return [];
      }

      return await this.transcribeBuffer(combinedBuffer, meetingId);

    } catch (error) {
      logger.error('Error in realtime transcription:', error);
      throw error;
    }
  }

  /**
   * Mescla transcrições parciais em texto completo
   */
  mergeTranscripts(chunks: TranscriptChunk[]): string {
    return chunks
      .map(chunk => chunk.text.trim())
      .filter(text => text.length > 0)
      .join(' ');
  }

  /**
   * Salva transcrição completa em arquivo
   */
  async saveTranscript(
    meetingId: string,
    chunks: TranscriptChunk[]
  ): Promise<string> {
    try {
      const transcriptDir = path.join(process.cwd(), 'data', 'transcripts');
      if (!fs.existsSync(transcriptDir)) {
        fs.mkdirSync(transcriptDir, { recursive: true });
      }

      const filePath = path.join(transcriptDir, `${meetingId}.json`);
      
      const transcriptData = {
        meetingId,
        chunks,
        fullText: this.mergeTranscripts(chunks),
        createdAt: new Date().toISOString(),
        totalChunks: chunks.length
      };

      fs.writeFileSync(filePath, JSON.stringify(transcriptData, null, 2));
      
      logger.info(`Transcript saved to: ${filePath}`);
      return filePath;

    } catch (error) {
      logger.error('Error saving transcript:', error);
      throw error;
    }
  }
}

// Singleton
export const transcriptionService = new TranscriptionService();
