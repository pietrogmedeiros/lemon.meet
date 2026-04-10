import puppeteer, { Browser, Page } from 'puppeteer';
import { logger } from '../utils/logger';

interface BrowserInstance {
  id: string;
  browser: Browser;
  inUse: boolean;
  createdAt: Date;
  lastUsed: Date;
}

export class BrowserPool {
  private instances: Map<string, BrowserInstance> = new Map();
  private readonly maxInstances: number;
  private readonly maxIdleTime: number; // em milissegundos

  constructor(maxInstances: number = 3, maxIdleTime: number = 10 * 60 * 1000) {
    this.maxInstances = maxInstances;
    this.maxIdleTime = maxIdleTime;
    
    // Cleanup periódico de instâncias ociosas
    setInterval(() => this.cleanupIdleInstances(), 60000); // a cada 1 minuto
  }

  /**
   * Obtém uma instância do navegador disponível ou cria uma nova
   */
  async acquire(): Promise<{ id: string; browser: Browser }> {
    // Procura por uma instância ociosa
    for (const [id, instance] of this.instances) {
      if (!instance.inUse) {
        instance.inUse = true;
        instance.lastUsed = new Date();
        logger.info(`Browser instance ${id} reused`);
        return { id, browser: instance.browser };
      }
    }

    // Se não há instâncias disponíveis e atingiu o limite, aguarda
    if (this.instances.size >= this.maxInstances) {
      throw new Error(`Maximum browser instances (${this.maxInstances}) reached. Please wait.`);
    }

    // Cria nova instância
    const id = `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const browser = await this.createBrowser();

    this.instances.set(id, {
      id,
      browser,
      inUse: true,
      createdAt: new Date(),
      lastUsed: new Date()
    });

    logger.info(`New browser instance created: ${id} (total: ${this.instances.size})`);
    return { id, browser };
  }

  /**
   * Libera uma instância do navegador para reutilização
   */
  async release(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      logger.warn(`Attempted to release unknown browser instance: ${id}`);
      return;
    }

    instance.inUse = false;
    instance.lastUsed = new Date();
    logger.info(`Browser instance ${id} released`);
  }

  /**
   * Fecha e remove uma instância específica
   */
  async destroy(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }

    try {
      await instance.browser.close();
      this.instances.delete(id);
      logger.info(`Browser instance ${id} destroyed (total: ${this.instances.size})`);
    } catch (error) {
      logger.error(`Error destroying browser instance ${id}:`, error);
    }
  }

  /**
   * Cria uma nova instância do navegador com configurações para Meet
   */
  private async createBrowser(): Promise<Browser> {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--disable-blink-features=AutomationControlled',
        // Permissões para câmera e microfone
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // Otimizações de memória
        '--disable-features=site-per-process',
        '--single-process'
      ],
      defaultViewport: {
        width: 1280,
        height: 720
      }
    });

    // Listener para crash do navegador
    browser.on('disconnected', () => {
      const instanceEntry = Array.from(this.instances.entries()).find(
        ([_, inst]) => inst.browser === browser
      );
      if (instanceEntry) {
        logger.error(`Browser instance ${instanceEntry[0]} crashed unexpectedly`);
        this.instances.delete(instanceEntry[0]);
      }
    });

    return browser;
  }

  /**
   * Remove instâncias que estão ociosas há muito tempo
   */
  private async cleanupIdleInstances(): Promise<void> {
    const now = Date.now();
    const toDestroy: string[] = [];

    for (const [id, instance] of this.instances) {
      if (!instance.inUse && (now - instance.lastUsed.getTime()) > this.maxIdleTime) {
        toDestroy.push(id);
      }
    }

    for (const id of toDestroy) {
      logger.info(`Cleaning up idle browser instance: ${id}`);
      await this.destroy(id);
    }
  }

  /**
   * Retorna estatísticas do pool
   */
  getStats() {
    return {
      total: this.instances.size,
      inUse: Array.from(this.instances.values()).filter(i => i.inUse).length,
      available: Array.from(this.instances.values()).filter(i => !i.inUse).length,
      maxInstances: this.maxInstances
    };
  }

  /**
   * Fecha todas as instâncias (shutdown)
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down browser pool...');
    const promises = Array.from(this.instances.keys()).map(id => this.destroy(id));
    await Promise.all(promises);
    logger.info('Browser pool shutdown complete');
  }
}

// Singleton
export const browserPool = new BrowserPool(
  parseInt(process.env.MAX_CONCURRENT_MEETINGS || '3', 10)
);
