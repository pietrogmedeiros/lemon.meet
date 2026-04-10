import { EventEmitter } from 'events';
import { transcriptionService, TranscriptChunk } from './TranscriptionService';
import { insightsService } from './InsightsService';
import { supabase } from '../config/supabase';
import { getIO } from '../config/socket';
import { logger } from '../utils/logger';

interface AudioBuffer {
  meetingId: string;
  chunks: Buffer[];
  lastProcessedAt: Date;
}

export class AudioProcessorService extends EventEmitter {
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly batchIntervalMs: number = 5000; // Processa a cada 5 segundos
  private readonly minChunkSize: number = 1024; // Tamanho mínimo do buffer

  constructor() {
    super();
  }

  /**
   * Inicia processamento periódico de áudio
   */
  start(): void {
    if (this.processingInterval) {
      logger.warn('Audio processor already running');
      return;
    }

    logger.info('Starting audio processor service');
    
    this.processingInterval = setInterval(() => {
      this.processBatches();
    }, this.batchIntervalMs);
  }

  /**
   * Para processamento
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info('Audio processor stopped');
    }
  }

  /**
   * Adiciona chunk de áudio ao buffer de uma reunião
   */
  addAudioChunk(meetingId: string, audioChunk: Buffer): void {
    let buffer = this.audioBuffers.get(meetingId);

    if (!buffer) {
      buffer = {
        meetingId,
        chunks: [],
        lastProcessedAt: new Date()
      };
      this.audioBuffers.set(meetingId, buffer);
      logger.info(`Created audio buffer for meeting: ${meetingId}`);
    }

    buffer.chunks.push(audioChunk);
    logger.debug(`Added audio chunk to meeting ${meetingId}: ${audioChunk.length} bytes`);
  }

  /**
   * Processa batches de áudio acumulados
   */
  private async processBatches(): Promise<void> {
    const now = new Date();

    for (const [meetingId, buffer] of this.audioBuffers.entries()) {
      try {
        // Verifica se há chunks suficientes
        if (buffer.chunks.length === 0) {
          continue;
        }

        // Verifica se passou tempo suficiente desde a última transcrição
        const timeSinceLastProcess = now.getTime() - buffer.lastProcessedAt.getTime();
        if (timeSinceLastProcess < this.batchIntervalMs) {
          continue;
        }

        // Calcula tamanho total
        const totalSize = buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (totalSize < this.minChunkSize) {
          logger.debug(`Buffer for ${meetingId} too small: ${totalSize} bytes`);
          continue;
        }

        logger.info(`Processing audio batch for meeting ${meetingId}: ${buffer.chunks.length} chunks, ${totalSize} bytes`);

        // Transcreve batch
        const transcriptChunks = await transcriptionService.transcribeRealtime(
          buffer.chunks,
          meetingId
        );

        if (transcriptChunks.length > 0) {
          // Salva no banco de dados
          await this.saveTranscriptChunks(meetingId, transcriptChunks);

          // Emite via WebSocket
          this.emitTranscripts(meetingId, transcriptChunks);

          // Limpa chunks processados
          buffer.chunks = [];
          buffer.lastProcessedAt = now;

          logger.info(`Processed ${transcriptChunks.length} transcript chunks for meeting ${meetingId}`);
        }

      } catch (error) {
        logger.error(`Error processing batch for meeting ${meetingId}:`, error);
        // Não limpa o buffer em caso de erro - tenta novamente depois
      }
    }
  }

  /**
   * Salva chunks de transcrição no banco de dados
   */
  private async saveTranscriptChunks(
    meetingId: string,
    chunks: TranscriptChunk[]
  ): Promise<void> {
    try {
      // Busca transcrição existente
      const { data: meeting, error: fetchError } = await supabase
        .from('meetings')
        .select('transcript')
        .eq('id', meetingId)
        .single();

      if (fetchError) {
        logger.error('Error fetching meeting for transcript update:', fetchError);
        return;
      }

      // Combina com transcrição existente
      const existingTranscript = meeting?.transcript || '';
      const newText = chunks.map(c => c.text).join(' ');
      const updatedTranscript = existingTranscript 
        ? `${existingTranscript} ${newText}`
        : newText;

      // Atualiza no banco
      const { error: updateError } = await supabase
        .from('meetings')
        .update({
          transcript: updatedTranscript.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', meetingId);

      if (updateError) {
        logger.error('Error updating transcript:', updateError);
      }

    } catch (error) {
      logger.error('Error saving transcript chunks:', error);
    }
  }

  /**
   * Emite transcrições via WebSocket
   */
  private emitTranscripts(meetingId: string, chunks: TranscriptChunk[]): void {
    try {
      const io = getIO();
      
      for (const chunk of chunks) {
        io.to(`meeting:${meetingId}`).emit('transcript:chunk', {
          meetingId,
          text: chunk.text,
          timestamp: chunk.timestamp.toISOString(),
          duration: chunk.duration,
          language: chunk.language
        });
      }

      // Emite evento de atualização completa
      const fullText = chunks.map(c => c.text).join(' ');
      io.to(`meeting:${meetingId}`).emit('transcript:update', {
        meetingId,
        text: fullText,
        chunks: chunks.length
      });

    } catch (error) {
      logger.error('Error emitting transcripts via WebSocket:', error);
    }
  }

  /**
   * Limpa buffer de uma reunião
   */
  clearBuffer(meetingId: string): void {
    this.audioBuffers.delete(meetingId);
    logger.info(`Cleared audio buffer for meeting: ${meetingId}`);
  }

  /**
   * Finaliza processamento de uma reunião e salva transcrição completa
   */
  async finalizeMeeting(meetingId: string): Promise<void> {
    try {
      // Processa chunks restantes
      const buffer = this.audioBuffers.get(meetingId);
      if (buffer && buffer.chunks.length > 0) {
        logger.info(`Processing remaining chunks for meeting ${meetingId}`);
        
        const transcriptChunks = await transcriptionService.transcribeRealtime(
          buffer.chunks,
          meetingId
        );

        if (transcriptChunks.length > 0) {
          await this.saveTranscriptChunks(meetingId, transcriptChunks);
          this.emitTranscripts(meetingId, transcriptChunks);
        }
      }

      // Busca transcrição final
      const { data: meeting } = await supabase
        .from('meetings')
        .select('transcript')
        .eq('id', meetingId)
        .single();

      if (meeting?.transcript) {
        // Salva em arquivo
        const chunks: TranscriptChunk[] = [{
          text: meeting.transcript,
          timestamp: new Date()
        }];
        
        await transcriptionService.saveTranscript(meetingId, chunks);
      }

      // Limpa buffer
      this.clearBuffer(meetingId);

      // Emite evento de conclusão
      const io = getIO();
      io.to(`meeting:${meetingId}`).emit('transcript:complete', {
        meetingId,
        timestamp: new Date().toISOString()
      });

      logger.info(`Finalized transcription for meeting ${meetingId}`);
  // Gera insights de forma assíncrona (não bloqueia)
      if (meeting?.transcript && meeting.transcript.trim().length > 50) {
        logger.info(`Generating insights for meeting ${meetingId}`);
        insightsService.generateInsightsAsync(meetingId).catch(error => {
          logger.error(`Failed to generate insights for meeting ${meetingId}:`, error);
        });
      }

    
    } catch (error) {
      logger.error(`Error finalizing meeting ${meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Retorna estatísticas dos buffers
   */
  getStats() {
    const stats = Array.from(this.audioBuffers.entries()).map(([meetingId, buffer]) => ({
      meetingId,
      chunksCount: buffer.chunks.length,
      totalBytes: buffer.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
      lastProcessedAt: buffer.lastProcessedAt.toISOString()
    }));

    return {
      activeMeetings: this.audioBuffers.size,
      meetings: stats
    };
  }
}

// Singleton
export const audioProcessorService = new AudioProcessorService();
