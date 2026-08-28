/**
 * O alerta de bots parados é o único aviso que sai do produto quando o produto
 * para. Se ele falhar em silêncio, ninguém descobre — foi exatamente o que
 * aconteceu em 28/08, quando o alerta existia só dentro do app e o Pietro só
 * soube horas depois. Um alerta não testado é indistinguível de um alerta que
 * não existe, então estes testes cobrem o caminho inteiro do envio.
 */
import { sendAlertEmail } from './alertEmail.js'

const ENV_ORIGINAL = { ...process.env }
const FETCH_ORIGINAL = global.fetch

/** Espião escrito à mão: a suíte roda em ESM, onde o global `jest` não existe. */
interface FetchSpy {
  calls: Array<[string, { headers: Record<string, string>; body: string }]>
  responde: (r: unknown) => void
  rejeita: (e: Error) => void
}

function espionarFetch(): FetchSpy {
  let resposta: unknown = { ok: true, status: 200, text: async () => '{}' }
  let erro: Error | null = null
  const spy: FetchSpy = {
    calls: [],
    responde: (r) => { resposta = r; erro = null },
    rejeita: (e) => { erro = e },
  }
  ;(global as unknown as { fetch: unknown }).fetch = async (url: string, init: never) => {
    spy.calls.push([url, init])
    if (erro) throw erro
    return resposta
  }
  return spy
}

describe('sendAlertEmail', () => {
  let fetchMock: FetchSpy

  beforeEach(() => {
    fetchMock = espionarFetch()
    process.env.RESEND_API_KEY = 'chave-de-teste'
    process.env.ALERT_EMAIL_TO = 'destino@exemplo.com'
    delete process.env.ALERT_EMAIL_FROM
  })

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL }
    global.fetch = FETCH_ORIGINAL
  })

  it('envia assunto e corpo para o destinatário configurado', async () => {
    const ok = await sendAlertEmail({ subject: 'bots parados', body: 'faça isto' })

    expect(ok).toBe(true)
    expect(fetchMock.calls).toHaveLength(1)
    const [url, init] = fetchMock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer chave-de-teste')
    const payload = JSON.parse(init.body)
    expect(payload.to).toEqual(['destino@exemplo.com'])
    expect(payload.subject).toBe('bots parados')
    expect(payload.text).toBe('faça isto')
  })

  it('respeita ALERT_EMAIL_FROM quando definido', async () => {
    process.env.ALERT_EMAIL_FROM = 'alertas@benicio.space'
    await sendAlertEmail({ subject: 'x', body: 'y' })
    expect(JSON.parse(fetchMock.calls[0][1].body).from).toBe('alertas@benicio.space')
  })

  it('sem chave configurada NÃO chama a API e devolve false', async () => {
    // Estado real de produção entre o deploy e a hora em que as variáveis foram
    // coladas: o resto do sistema tem que seguir funcionando.
    delete process.env.RESEND_API_KEY
    expect(await sendAlertEmail({ subject: 'x', body: 'y' })).toBe(false)
    expect(fetchMock.calls).toHaveLength(0)
  })

  it('sem destinatário configurado NÃO chama a API', async () => {
    delete process.env.ALERT_EMAIL_TO
    expect(await sendAlertEmail({ subject: 'x', body: 'y' })).toBe(false)
    expect(fetchMock.calls).toHaveLength(0)
  })

  it('devolve false quando o Resend recusa, sem estourar exceção', async () => {
    // Chave inválida ou domínio não verificado. O webhook do Skribby que chama
    // isto não pode quebrar por causa de um e-mail que não saiu.
    fetchMock.responde({ ok: false, status: 403, text: async () => 'domain not verified' })
    await expect(sendAlertEmail({ subject: 'x', body: 'y' })).resolves.toBe(false)
  })

  it('devolve false quando a rede cai, sem estourar exceção', async () => {
    fetchMock.rejeita(new Error('ECONNRESET'))
    await expect(sendAlertEmail({ subject: 'x', body: 'y' })).resolves.toBe(false)
  })
})
