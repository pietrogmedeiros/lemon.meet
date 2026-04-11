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

    status.textContent = '✅ Microfone autorizado! Fechando...'

    // Notifica background/popup que a permissão foi concedida
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_GRANTED' })

    // Fecha a janela após pequeno delay para o usuário ver o feedback
    setTimeout(() => window.close(), 800)
  } catch (err) {
    status.textContent = '❌ Permissão negada. Você pode gravar apenas o áudio dos participantes.'
    chrome.runtime.sendMessage({ type: 'MIC_PERMISSION_DENIED' })
    setTimeout(() => window.close(), 2000)
  }
})
