import Groq, { toFile } from 'groq-sdk';
import { logger } from '../utils/logger.js';
import { transcriptionMetrics } from '../metrics.js';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'node:child_process';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Groq Whisper aceita ~25MB por request. Acima de GROQ_MAX_BYTES o áudio é
// dividido em segmentos via ffmpeg antes de transcrever (reuniões longas do
// app desktop). Abaixo disso, o caminho é idêntico ao de hoje (mobile).
const GROQ_MAX_BYTES = 24 * 1024 * 1024; // 24MB (margem de segurança)
const SEGMENT_SECONDS = 900;             // 15min por segmento

/** Resultado da sondagem de encoders — feita uma vez por processo. */
let encoderProbe: Promise<{ codec: string; ext: string; bitrate: string }> | null = null;

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
    const t0 = Date.now();
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

      const chunks = this.buildChunks(response as any);
      transcriptionMetrics.observe('file', 'success', (Date.now() - t0) / 1000);
      return chunks;

    } catch (error: any) {
      transcriptionMetrics.observe('file', 'error', (Date.now() - t0) / 1000);
      logger.error('Error transcribing audio:', error);
      throw error;
    }
  }

  /**
   * Transcreve lidando com áudios grandes (reuniões longas do app desktop).
   *
   * Arquivo dentro do limite do Groq → caminho normal (IDÊNTICO ao mobile).
   * Acima do limite, em ordem:
   *   1. comprime o áudio inteiro (16kHz mono opus 16kbps) — 1h vira ~7MB, e
   *      uma reunião de 3h ainda cabe numa requisição só;
   *   2. se mesmo comprimido passar do limite, segmenta o comprimido;
   *   3. se o ffmpeg não existir ou falhar, FALHA COM ERRO CLARO.
   *
   * ⚠️ O passo 3 já foi "mandar o arquivo inteiro mesmo assim". Isso é 413
   * garantido — foi o que perdeu a reunião de 01/09/2026, porque o áudio é
   * apagado depois do processamento e não existe do que reprocessar. Cair no
   * caminho que não pode funcionar é pior do que falhar dizendo o porquê.
   */
  async transcribeAudioSmart(audioFilePath: string): Promise<TranscriptChunk[]> {
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(audioFilePath).size;
    } catch {
      return this.transcribeAudio(audioFilePath);
    }

    if (sizeBytes <= GROQ_MAX_BYTES) {
      return this.transcribeAudio(audioFilePath); // caminho atual, inalterado
    }

    const sizeMb = (sizeBytes / 1024 / 1024).toFixed(1);
    logger.info(`[Transcription] Áudio grande (${sizeMb}MB) — comprimindo antes de transcrever`);

    let compressedPath: string | null = null;
    try {
      compressedPath = await this.compressForWhisper(audioFilePath);
      const compressedBytes = fs.statSync(compressedPath).size;
      logger.info(
        `[Transcription] Comprimido: ${sizeMb}MB → ${(compressedBytes / 1024 / 1024).toFixed(1)}MB`,
      );

      if (compressedBytes <= GROQ_MAX_BYTES) {
        const buf = fs.readFileSync(compressedPath);
        return await this.transcribeAudioBuffer(buf, path.basename(compressedPath));
      }

      logger.info(`[Transcription] Ainda acima do limite — segmentando em ${SEGMENT_SECONDS}s`);
      return await this.splitAndTranscribe(compressedPath);
    } catch (err: any) {
      logger.error('[Transcription] Não foi possível preparar o áudio grande:', err);
      throw new Error(
        `audio_too_large: ${sizeMb}MB acima do limite de ${(GROQ_MAX_BYTES / 1024 / 1024).toFixed(0)}MB do Whisper e a compressão falhou (${err?.message ?? err})`,
      );
    } finally {
      if (compressedPath) {
        try { fs.rmSync(compressedPath, { force: true }); } catch { /* ignore */ }
      }
    }
  }

  /** Reduz o áudio para 16kHz mono opus 16kbps — ~7MB por hora de reunião. */
  private async compressForWhisper(audioFilePath: string): Promise<string> {
    const outDir = path.join(process.cwd(), 'temp', 'compressed');
    fs.mkdirSync(outDir, { recursive: true });
    const enc = await TranscriptionService.audioEncoder();
    const outPath = path.join(outDir, `${Date.now()}-${Math.round(Math.random() * 1e6)}.${enc.ext}`);

    await this.runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', audioFilePath,
      '-ar', '16000', '-ac', '1', '-c:a', enc.codec, '-b:a', enc.bitrate,
      outPath,
    ]);

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      throw new Error('ffmpeg não gerou o áudio comprimido');
    }
    return outPath;
  }

  /** ffmpeg está instalado e executável? Usado pelo /health. */
  static async ffmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('ffmpeg', ['-hide_banner', '-version']);
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
      proc.stdout?.resume();
      proc.stderr?.resume();
    });
  }

  /**
   * Escolhe o encoder de áudio pelo que o ffmpeg do ambiente REALMENTE tem.
   *
   * `libopus` é biblioteca externa e não está em toda build de ffmpeg; `aac` é
   * nativo e existe sempre. Assumir libopus é o que provavelmente derrubou a
   * reunião de 01/09: o ffmpeg estava lá (`/health` confirma), mas a etapa de
   * fatiar falhou e o código caía no envio do arquivo inteiro. Sondado uma vez
   * e memorizado.
   */
  static audioEncoder(): Promise<{ codec: string; ext: string; bitrate: string }> {
    encoderProbe ??= (async () => {
      try {
        const encoders = await TranscriptionService.runFfmpegCapture(['-hide_banner', '-encoders']);
        if (/\slibopus\s/.test(encoders)) {
          return { codec: 'libopus', ext: 'ogg', bitrate: '16k' };
        }
        logger.warn('[Transcription] ffmpeg sem libopus — usando o encoder aac nativo');
      } catch (err) {
        logger.warn(`[Transcription] não consegui listar encoders do ffmpeg (${err}) — assumindo aac`);
      }
      return { codec: 'aac', ext: 'm4a', bitrate: '24k' };
    })();
    return encoderProbe;
  }

  private static runFfmpegCapture(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let out = '';
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.stderr.on('data', () => { /* ffmpeg escreve banner no stderr */ });
      proc.on('error', (err) => reject(new Error(`ffmpeg indisponível: ${err.message}`)));
      proc.on('close', () => resolve(out));
    });
  }

  /** Divide o áudio em segmentos (ffmpeg → 16kHz mono) e transcreve cada. */
  private async splitAndTranscribe(audioFilePath: string): Promise<TranscriptChunk[]> {
    const segDir = path.join(process.cwd(), 'temp', 'segments', `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
    fs.mkdirSync(segDir, { recursive: true });

    try {
      const enc = await TranscriptionService.audioEncoder();
      await this.runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', audioFilePath,
        '-ar', '16000', '-ac', '1', '-c:a', enc.codec, '-b:a', enc.bitrate,
        '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS),
        path.join(segDir, `seg%03d.${enc.ext}`),
      ]);

      const segFiles = fs.readdirSync(segDir)
        .filter((f) => f.startsWith('seg') && f.endsWith(`.${enc.ext}`))
        .sort();

      if (segFiles.length === 0) throw new Error('ffmpeg não gerou segmentos');

      const all: TranscriptChunk[] = [];
      for (let i = 0; i < segFiles.length; i++) {
        const offset = i * SEGMENT_SECONDS;
        const buf = fs.readFileSync(path.join(segDir, segFiles[i]));
        const chunks = await this.transcribeAudioBuffer(buf, segFiles[i]);
        for (const c of chunks) {
          all.push({
            ...c,
            startSeconds: (c.startSeconds ?? 0) + offset,
            endSeconds: (c.endSeconds ?? 0) + offset,
          });
        }
      }
      return all;
    } finally {
      try { fs.rmSync(segDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', (err) => reject(new Error(`ffmpeg indisponível: ${err.message}`)));
      proc.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(0, 300)}`)),
      );
    });
  }

  /**
   * Transcreve um buffer de áudio deixando o Groq inferir o formato pelo nome do
   * arquivo (ex.: "meeting.flac" do MeetingBaas). Diferente de transcribeBuffer,
   * não força .webm/audio-webm — essencial para áudio não-webm.
   */
  async transcribeAudioBuffer(audioBuffer: Buffer, filename: string): Promise<TranscriptChunk[]> {
    const t0 = Date.now();
    try {
      const audioFile = await toFile(audioBuffer, filename);
      const response = await groq.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3-turbo',
        language: 'pt',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      });
      logger.info(`Transcription (buffer ${filename}) completed: ${response.text.length} characters`);
      const chunks = this.buildChunks(response as any);
      transcriptionMetrics.observe('buffer', 'success', (Date.now() - t0) / 1000);
      return chunks;
    } catch (error: any) {
      transcriptionMetrics.observe('buffer', 'error', (Date.now() - t0) / 1000);
      throw error;
    }
  }

  /** Converte a resposta verbose_json do Whisper em chunks, filtrando alucinações. */
  private buildChunks(verboseResponse: any): TranscriptChunk[] {
    const chunks: TranscriptChunk[] = [];

    // Limiar de probabilidade de não-fala — segmentos acima disso são alucinações do Whisper.
    // 0.85 preserva muito mais conteúdo válido; o filtro agressivo (0.6) descartava fala real.
    const NO_SPEECH_THRESHOLD = 0.85;

    if (verboseResponse.segments && Array.isArray(verboseResponse.segments)) {
      for (const segment of verboseResponse.segments) {
        const noSpeechProb = segment.no_speech_prob ?? 0;
        if (noSpeechProb > NO_SPEECH_THRESHOLD) {
          logger.debug(`Seg descartado (no_speech_prob=${noSpeechProb.toFixed(2)}): "${(segment.text ?? '').trim()}"`);
          continue;
        }
        const text = (segment.text ?? '').trim();
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
    } else if ((verboseResponse.text ?? '').trim()) {
      chunks.push({
        text: verboseResponse.text.trim(),
        timestamp: new Date(),
        language: verboseResponse.language ?? 'pt',
        startSeconds: 0,
        endSeconds: 0,
      });
    }

    return chunks;
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
