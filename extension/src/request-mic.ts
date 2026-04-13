// request-mic.ts
// Página aberta em janela separada para solicitar permissão de microfone.
// Janelas abertas via chrome.windows.create são visíveis e mostram o prompt
// normalmente, diferente do popup (que fecha ao perder foco).

const btn = document.getElementById('btn') as HTMLButtonElement
const status = document.getElementById('status') as HTMLDivElement

btn.addEventListener('click', async () => {
  btn.disabled = true
  status.textContent = 'Aguardando permissão...'

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    // Para todas as tracks imediatamente — só precisávamos do grant
    stream.getTracks().forEach(t => t.stop())

    status.textContent = '✅ Microfone autorizado! Iniciando gravação...'

    // Marca mic como autorizado para que fluxos futuros (via botão flutuante)
    // não precisem abrir esta janela novamente
    await chrome.storage.local.set({ micGranted: true })

    // Lê o pendingCapture salvo pelo popup (streamId + tabId) e dispara a gravação.
    // O popup já fechou neste ponto — esta página é a única executando.
    const stored = await chrome.storage.local.get('pendingCapture')
    if (stored.pendingCapture) {
      const { tabId, streamId } = stored.pendingCapture
      await chrome.storage.local.remove('pendingCapture')
      chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId, streamId })
    }

    // Fecha a janela após pequeno delay para o usuário ver o feedback
    setTimeout(() => window.close(), 800)
  } catch (err) {
    status.textContent = '❌ Permissão negada. Você pode gravar apenas o áudio dos participantes.'
    // Tenta gravar mesmo sem mic (só áudio da aba) se houver pendingCapture
    const stored = await chrome.storage.local.get('pendingCapture')
    if (stored.pendingCapture) {
      const { tabId, streamId } = stored.pendingCapture
      await chrome.storage.local.remove('pendingCapture')
      chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId, streamId })
    }
    setTimeout(() => window.close(), 2000)
  }
})
