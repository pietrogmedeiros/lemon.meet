import { Browser, Page } from 'puppeteer';
import { browserPool } from './BrowserPool';
import { AudioCaptureService } from './AudioCaptureService';
import { audioProcessorService } from './AudioProcessorService';
import { supabase } from '../config/supabase';
import { logger } from '../utils/logger';
import { getIO } from '../config/socket';

interface BotSession {
  meetingId: string;
  browserId: string;
  page: Page;
  meetLink: string;
  audioCapture: AudioCaptureService;
  startedAt: Date;
}

export class MeetBotService {
  private activeSessions: Map<string, BotSession> = new Map();

  /**
   * Entra em uma reunião do Google Meet e inicia a captura de áudio
   */
  async joinMeeting(meetingId: string, meetLink: string, userId: string): Promise<void> {
    // Verifica se já existe uma sessão ativa para esta reunião
    if (this.activeSessions.has(meetingId)) {
      throw new Error('Meeting bot is already active for this meeting');
    }

    logger.info(`Starting bot for meeting ${meetingId} - ${meetLink}`);

    try {
      // Obtém instância do navegador do pool
      const { id: browserId, browser } = await browserPool.acquire();
      const page = await browser.newPage();

      // Configura permissões para câmera e microfone
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://meet.google.com', [
        'microphone',
        'camera',
        'notifications'
      ]);

      // Define User-Agent para evitar detecção de bot
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Navega para o Meet
      logger.info(`Navigating to Meet URL: ${meetLink}`);
      await page.goto(meetLink, { waitUntil: 'networkidle2', timeout: 30000 });

      // Aguarda alguns segundos para a página carregar
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Tenta clicar no botão "Entrar agora" ou "Join now"
      // Possíveis seletores de acordo com idioma
      const joinButtonSelectors = [
        'button[jsname="Qx7uuf"]', // Seletor específico do Meet
        'button:has-text("Participar agora")',
        'button:has-text("Join now")',
        'button:has-text("Ask to join")',
        'div[role="button"]:has-text("Join")',
        'span:has-text("Join now")'
      ];

      let joined = false;
      for (const selector of joinButtonSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          await page.click(selector);
          logger.info(`Clicked join button with selector: ${selector}`);
          joined = true;
          break;
        } catch (e) {
          // Tenta próximo seletor
          continue;
        }
      }

      if (!joined) {
        // Fallback: tenta encontrar qualquer botão que contenha "join" ou "participar"
        await page.evaluate(() => {
          // @ts-expect-error - document is available in browser context
          const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
          const joinButton = buttons.find((btn: any) => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('join') || text.includes('participar') || text.includes('entrar');
          });
          if (joinButton) {
            (joinButton as any).click();
          }
        });
        logger.warn('Used fallback method to click join button');
      }

      // Aguarda entrada na reunião (verifica se há vídeos ou participantes)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Desliga câmera e microfone do bot para não interferir
      await this.toggleMediaDevices(page, false, false);

      // Inicia captura de áudio via CDP
      const audioCapture = new AudioCaptureService(page, meetingId);
      await audioCapture.startCapture();

      // Registra sessão ativa
      this.activeSessions.set(meetingId, {
        meetingId,
        browserId,
        page,
        meetLink,
        audioCapture,
        startedAt: new Date()
      });

      // Atualiza status no banco de dados
      await supabase
        .from('meetings')
        .update({
          status: 'recording',
          started_at: new Date().toISOString()
        })
        .eq('id', meetingId);

      // Notifica via WebSocket
      const io = getIO();
      io.to(`meeting:${meetingId}`).emit('bot:joined', {
        meetingId,
        startedAt: new Date().toISOString()
      });

      logger.info(`Bot successfully joined meeting ${meetingId}`);

    } catch (error) {
      logger.error(`Error joining meeting ${meetingId}:`, error);
      
      // Limpa recursos em caso de erro
      const session = this.activeSessions.get(meetingId);
      if (session) {
        await this.cleanup(meetingId);
      }

      // Atualiza status para erro
      await supabase
        .from('meetings')
        .update({ status: 'error' })
        .eq('id', meetingId);

      throw error;
    }
  }

  /**
   * Para o bot e encerra a captura de áudio
   */
  async stopMeeting(meetingId: string): Promise<void> {
    const session = this.activeSessions.get(meetingId);
    if (!session) {
      throw new Error('No active bot session found for this meeting');
    }

    logger.info(`Stopping bot for meeting ${meetingId}`);

    try {
      // Para captura de áudio
      await session.audioCapture.stopCapture();

      // Finaliza processamento e transcrição
      await audioProcessorService.finalizeMeeting(meetingId);

      // Fecha página e libera navegador
      await session.page.close();
      await browserPool.release(session.browserId);

      // Remove sessão ativa
      this.activeSessions.delete(meetingId);

      // Atualiza status no banco de dados
      await supabase
        .from('meetings')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString()
        })
        .eq('id', meetingId);

      const io = getIO();
      // Notifica via WebSocket
      io.to(`meeting:${meetingId}`).emit('bot:left', {
        meetingId,
        endedAt: new Date().toISOString()
      });

      logger.info(`Bot stopped for meeting ${meetingId}`);

    } catch (error) {
      logger.error(`Error stopping meeting ${meetingId}:`, error);
      throw error;
    }
  }

  /**
   * Desliga/liga câmera e microfone
   */
  private async toggleMediaDevices(page: Page, camera: boolean, microphone: boolean): Promise<void> {
    try {
      // Seletores dos botões de câmera e microfone
      const cameraButton = 'button[data-is-muted="false"][aria-label*="camera"], button[data-is-muted="false"][aria-label*="câmera"]';
      const micButton = 'button[data-is-muted="false"][aria-label*="microphone"], button[data-is-muted="false"][aria-label*="microfone"]';

      if (!camera) {
        try {
          await page.click(cameraButton);
          logger.debug('Camera turned off');
        } catch (e) {
          logger.warn('Could not toggle camera');
        }
      }

      if (!microphone) {
        try {
          await page.click(micButton);
          logger.debug('Microphone turned off');
        } catch (e) {
          logger.warn('Could not toggle microphone');
        }
      }
    } catch (error) {
      logger.warn('Error toggling media devices:', error);
    }
  }

  /**
   * Cleanup de recursos
   */
  private async cleanup(meetingId: string): Promise<void> {
    const session = this.activeSessions.get(meetingId);
    if (!session) return;

    try {
      await session.audioCapture.stopCapture();
      await session.page.close();
      await browserPool.release(session.browserId);
      this.activeSessions.delete(meetingId);
    } catch (error) {
      logger.error(`Error during cleanup for meeting ${meetingId}:`, error);
    }
  }

  /**
   * Retorna lista de reuniões ativas
   */
  getActiveMeetings(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * Verifica se uma reunião está ativa
   */
  isActive(meetingId: string): boolean {
    return this.activeSessions.has(meetingId);
  }

  /**
   * Shutdown de todas as sessões
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down all bot sessions...');
    const promises = Array.from(this.activeSessions.keys()).map(id => this.cleanup(id));
    await Promise.all(promises);
    logger.info('All bot sessions shut down');
  }
}

// Singleton
export const meetBotService = new MeetBotService();
