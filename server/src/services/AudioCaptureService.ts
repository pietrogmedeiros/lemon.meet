import { Page } from 'puppeteer';
import { CDPSession } from 'puppeteer';
import { logger } from '../utils/logger.js';
import { getIO } from '../config/socket.js';
import { audioProcessorService } from './AudioProcessorService.js';
import * as fs from 'fs';
import * as path from 'path';

export class AudioCaptureService {
  private page: Page;
  private meetingId: string;
  private cdpSession: CDPSession | null = null;
  private audioChunks: Buffer[] = [];
  private isCapturing: boolean = false;
  private audioFilePath: string;

  constructor(page: Page, meetingId: string) {
    this.page = page;
    this.meetingId = meetingId;
    
    // Define caminho para salvar áudio temporário
    const audioDir = path.join(process.cwd(), 'temp', 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    this.audioFilePath = path.join(audioDir, `${meetingId}.webm`);
  }

  /**
   * Inicia a captura de áudio via Chrome DevTools Protocol
   */
  async startCapture(): Promise<void> {
    if (this.isCapturing) {
      logger.warn(`Audio capture already active for meeting ${this.meetingId}`);
      return;
    }

    try {
      // Cria sessão CDP
      this.cdpSession = await this.page.target().createCDPSession();

      // Injeta script para capturar áudio do Meet
      await this.page.evaluateOnNewDocument(() => {
        // Override do getUserMedia para capturar stream
        // @ts-expect-error - navigator is available in browser
        const originalGetUserMedia = (navigator as any).mediaDevices.getUserMedia.bind((navigator as any).mediaDevices);
        // @ts-expect-error - navigator is available in browser
        (navigator as any).mediaDevices.getUserMedia = async function(constraints: any) {
          const stream = await originalGetUserMedia(constraints);
          
          // Envia informação sobre o stream capturado
          if (constraints.audio) {
            // @ts-expect-error - window is available in browser
            (window as any).__meetAudioStream = stream;
          }
          
          return stream;
        };
      });

      // Habilita domínios necessários no CDP
      await this.cdpSession.send('Page.enable');
      await this.cdpSession.send('Runtime.enable');
      await this.cdpSession.send('Inspector.enable');

      // Inicia gravação de áudio via Page Recorder (experimental)
      // Nota: Esta é uma abordagem simplificada. Em produção, considere usar
      // uma biblioteca específica para captura de áudio WebRTC
      
      this.isCapturing = true;
      logger.info(`Audio capture started for meeting ${this.meetingId}`);

      // Inicia captura via execução de script que grava o áudio
      await this.setupAudioRecording();

    } catch (error) {
      logger.error(`Error starting audio capture for meeting ${this.meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Configura gravação de áudio no contexto da página
   */
  private async setupAudioRecording(): Promise<void> {
    await this.page.evaluate(() => {
      return new Promise<void>((resolve) => {
        // Aguarda até que o stream de áudio esteja disponível
        const checkStream = setInterval(() => {
          // @ts-expect-error - window is available in browser
          const stream = (window as any).__meetAudioStream;
          if (stream) {
            clearInterval(checkStream);
            
            // Cria MediaRecorder para capturar áudio
            // @ts-expect-error - MediaRecorder is available in browser
            const mediaRecorder = new (window as any).MediaRecorder(stream, {
              mimeType: 'audio/webm;codecs=opus',
              audioBitsPerSecond: 128000
            });

            const audioChunks: any[] = [];

            mediaRecorder.ondataavailable = (event: any) => {
              if (event.data.size > 0) {
                audioChunks.push(event.data);
                
                // Envia chunk via custom event para ser capturado pelo CDP
                const customEvent = new CustomEvent('audioChunk', {
                  detail: { size: event.data.size }
                });
                // @ts-expect-error - window is available in browser
                window.dispatchEvent(customEvent);
              }
            };

            mediaRecorder.onstop = () => {
              // Quando parar, cria blob final
              const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
              // @ts-expect-error - window is available in browser
              (window as any).__finalAudioBlob = audioBlob;
            };

            // Inicia gravação com chunks a cada 5 segundos
            mediaRecorder.start(5000);
            // @ts-expect-error - window is available in browser
            (window as any).__mediaRecorder = mediaRecorder;
            
            resolve();
          }
        }, 1000);
      });
    });

    // Listener para eventos de chunks de áudio
    this.page.on('console', (msg) => {
      if (msg.text().includes('audioChunk')) {
        // Notifica via WebSocket que tem novo áudio
        const io = getIO();
        io.to(`meeting:${this.meetingId}`).emit('audio:chunk', {
          meetingId: this.meetingId,
          timestamp: new Date().toISOString()
        });
      }
    });

    logger.info(`Audio recording setup complete for meeting ${this.meetingId}`);
  }

  /**
   * Para a captura de áudio
   */
  async stopCapture(): Promise<string> {
    if (!this.isCapturing) {
      logger.warn(`No active audio capture for meeting ${this.meetingId}`);
      return '';
    }

    try {
      // Para o MediaRecorder no contexto da página
      await this.page.evaluate(() => {
        // @ts-expect-error - window is available in browser
        const recorder = (window as any).__mediaRecorder;
        if (recorder && recorder.state !== 'inactive') {
          recorder.stop();
        }
      });

      // Aguarda um pouco para o blob ser criado
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Extrai blob de áudio
      const audioBlob = await this.page.evaluate(() => {
        // @ts-expect-error - window is available in browser
        const blob = (window as any).__finalAudioBlob;
        if (!blob) return null;
        
        return new Promise((resolve) => {
          // @ts-expect-error - FileReader is available in browser
          const reader = new (window as any).FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        });
      });

      if (audioBlob && typeof audioBlob === 'string') {
        // Converte base64 para buffer e salva
        const base64Data = audioBlob.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(this.audioFilePath, buffer);
        logger.info(`Audio saved to ${this.audioFilePath}`);
      }

      // Fecha sessão CDP
      if (this.cdpSession) {
        await this.cdpSession.detach();
        this.cdpSession = null;
      }

      this.isCapturing = false;
      logger.info(`Audio capture stopped for meeting ${this.meetingId}`);

      return this.audioFilePath;

    } catch (error) {
      logger.error(`Error stopping audio capture for meeting ${this.meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Retorna o caminho do arquivo de áudio gravado
   */
  getAudioFilePath(): string {
    return this.audioFilePath;
  }

  /**
   * Verifica se está capturando
   */
  isActive(): boolean {
    return this.isCapturing;
  }
}
