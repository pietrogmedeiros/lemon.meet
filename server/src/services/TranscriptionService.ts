import OpenAI from 'openai';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export interface TranscriptChunk {
  text: string;
  timestamp: Date;
  duration?: number;
  language?: string;
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

      // Cria stream de leitura do arquivo
      const audioStream = fs.createReadStream(audioFilePath);

      // Envia para Whisper API
      const response = await openai.audio.transcriptions.create({
        file: audioStream,
        model: 'whisper-1',
        language: 'pt', // português por padrão
        response_format: 'verbose_json', // retorna timestamps
        timestamp_granularities: ['segment'] // timestamps por segmento
      });

      logger.info(`Transcription completed: ${response.text.length} characters`);

      // Converte resposta verbose em chunks
      const chunks: TranscriptChunk[] = [];

      if (response.segments && Array.isArray(response.segments)) {
        for (const segment of response.segments) {
          chunks.push({
            text: segment.text,
            timestamp: new Date(Date.now() + (segment.start || 0) * 1000),
            duration: (segment.end || 0) - (segment.start || 0),
            language: response.language
          });
        }
      } else {
        // Fallback se não houver segmentos
        chunks.push({
          text: response.text,
          timestamp: new Date(),
          language: response.language
        });
      }

      return chunks;

    } catch (error: any) {
      logger.error('Error transcribing audio:', error);
      
      // Trata erros específicos da API
      if (error.response) {
        logger.error('OpenAI API error:', {
          status: error.response.status,
          data: error.response.data
        });
      }

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
