/**
 * Browser context type declarations
 * These types are available inside Puppeteer's page.evaluate() contexts
 * but not in Node.js context. This file suppresses TypeScript errors
 * for browser APIs used within evaluate() callbacks.
 */

// Extend Window interface for custom properties
declare global {
  interface Window {
    __meetAudioStream?: MediaStream;
    __mediaRecorder?: MediaRecorder;
    __finalAudioBlob?: Blob;
    MediaRecorder: typeof MediaRecorder;
    FileReader: typeof FileReader;
  }
}

export {};
