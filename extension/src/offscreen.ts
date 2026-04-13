// ============================================================
// offscreen.ts — Documento offscreen da extensão Lemon.meet
// Responsável por gravar áudio via getUserMedia + MediaRecorder
// Mistura tab audio (participantes remotos) + microfone (voz local)
// ============================================================

const API_URL = 'https://vibe-aiserver-production.up.railway.app'

let mediaRecorder: MediaRecorder | null = null
let audioContext: AudioContext | null = null
let chunkIndex = 0

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
  }
})

async function startCapture(streamId: string, meetingId: string, accessToken: string) {
  // 1. Captura áudio da aba (participantes remotos)
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // @ts-ignore — Chrome-specific constraint para tab capture
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
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
}

function stopCapture() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return

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
