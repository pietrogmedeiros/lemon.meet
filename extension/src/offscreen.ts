// ============================================================
// offscreen.ts — Documento offscreen da extensão Lemon.meet
// Responsável por gravar áudio via getUserMedia + MediaRecorder
// Mistura tab audio (participantes remotos) + microfone (voz local)
// ============================================================

const API_URL = 'https://vibe-aiserver-production.up.railway.app'

let mediaRecorder: MediaRecorder | null = null
let audioContext: AudioContext | null = null
let chunkIndex = 0
let keepAliveInterval: ReturnType<typeof setInterval> | null = null

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'OFFSCREEN_START':
      startCapture(msg.streamId, msg.meetingId, msg.accessToken)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }))
      return true

    case 'OFFSCREEN_STOP':
      stopCapture()
      sendResponse({ ok: true })
      break

    case 'PING':
      // Responde confirmando que está vivo e retoma AudioContext se suspendido
      if (audioContext?.state === 'suspended') {
        audioContext.resume().catch(() => {})
      }
      sendResponse({ alive: true, recording: mediaRecorder?.state === 'recording' })
      return true
  }
})

async function startCapture(streamId: string, meetingId: string, accessToken: string) {
  // 1. Captura áudio da aba (participantes remotos)
  // suppressLocalAudioPlayback: false impede que o Chrome silencie o áudio da aba
  // ao realizar o tab capture — sem isso, os participantes ficam "mudos" para o gravador
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-ignore — Chrome-specific constraints para tab capture
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        suppressLocalAudioPlayback: false,
      },
    },
    video: false,
  } as any)

  // 2. Tenta capturar o microfone (voz local do usuário)
  let micStream: MediaStream | null = null
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    console.log('[Lemon.meet offscreen] Microfone capturado com sucesso')
  } catch (err) {
    console.warn('[Lemon.meet offscreen] Microfone não disponível, gravando apenas áudio da aba:', err)
  }

  // 3. Mistura as duas streams via AudioContext
  audioContext = new AudioContext()
  const destination = audioContext.createMediaStreamDestination()

  const tabSource = audioContext.createMediaStreamSource(tabStream)
  tabSource.connect(destination)
  // Passthrough: também conecta à saída do AudioContext para que o usuário
  // continue ouvindo os participantes normalmente enquanto grava
  tabSource.connect(audioContext.destination)

  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream)
    micSource.connect(destination)
  }

  chunkIndex = 0

  // 4. Grava o mix resultante
  mediaRecorder = new MediaRecorder(destination.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128_000, // 128kbps — qualidade suficiente para Whisper reconhecer fala
  })

  const sendChunk = async (blob: Blob, idx: number) => {
    const formData = new FormData()
    formData.append('audio', blob, `chunk-${idx}.webm`)
    formData.append('chunkIndex', String(idx))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${API_URL}/api/meetings/${meetingId}/chunk`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: formData,
        })
        if (res.ok) return
        console.warn(`[Lemon.meet offscreen] Chunk ${idx} retornou ${res.status}, tentativa ${attempt + 1}`)
      } catch (err) {
        console.error(`[Lemon.meet offscreen] Erro ao enviar chunk ${idx}, tentativa ${attempt + 1}:`, err)
      }
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
    }
    console.error(`[Lemon.meet offscreen] Chunk ${idx} falhou após 3 tentativas`)
  }

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size === 0) return
    const idx = chunkIndex++
    await sendChunk(e.data, idx)
  }

  mediaRecorder.start(10_000) // chunk a cada 10s — mais granular, menos chance de perder conteúdo
  console.log('[Lemon.meet offscreen] Gravação iniciada para meeting:', meetingId)

  // Heartbeat: mantém o Service Worker vivo enviando mensagens periódicas.
  // MV3 mata o SW após ~30s ocioso — cada mensagem recebida o mantém ativo.
  keepAliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_KEEPALIVE' }).catch(() => {
      console.warn('[Lemon.meet offscreen] Heartbeat falhou — SW pode ter sido encerrado')
    })
    // Garante que o AudioContext não fique suspenso por inatividade
    if (audioContext?.state === 'suspended') {
      audioContext.resume().catch(() => {})
    }
  }, 20_000) // a cada 20s — bem abaixo do limite de 30s do Chrome
}

function stopCapture() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return

  // Para o heartbeat imediatamente
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }

  // requestData() dispara ondataavailable com os dados pendentes
  // Aguardamos 800ms para garantir que o handler processe o chunk antes de parar
  mediaRecorder.requestData()
  setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach((t) => t.stop())
    }
    mediaRecorder = null
    audioContext?.close()
    audioContext = null
    console.log('[Lemon.meet offscreen] Gravação encerrada')
  }, 800)
}
