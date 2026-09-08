import { trilhosDisponiveis } from './paymentRails.js'

const limpo = { ...process.env }
afterEach(() => { process.env = { ...limpo } })

describe('trilhosDisponiveis', () => {
  it('sem nada configurado → não oferece compra', () => {
    delete process.env.ABACATEPAY_PIX_ONE_TIME
    delete process.env.BILLING_INFINITEPAY_TAG
    const d = trilhosDisponiveis()
    expect(d.habilitado).toBe(false)
    expect(d.trilhos).toEqual([])
    expect(d.motivo).toContain('equipe')
  })

  it('PIX só liga com a flag E a chave da AbacatePay', () => {
    process.env.ABACATEPAY_PIX_ONE_TIME = 'true'
    delete process.env.ABACATEPAY_API_KEY
    expect(trilhosDisponiveis().trilhos).toEqual([])

    process.env.ABACATEPAY_API_KEY = 'abc_dev_x'
    expect(trilhosDisponiveis().trilhos).toEqual(['pix'])
  })

  it('cartão liga só com a InfiniteTag — a InfinitePay não usa chave', () => {
    delete process.env.ABACATEPAY_PIX_ONE_TIME
    process.env.BILLING_INFINITEPAY_TAG = 'lemonmeet'
    const d = trilhosDisponiveis()
    expect(d.habilitado).toBe(true)
    expect(d.trilhos).toEqual(['card'])
  })

  it('tag em branco não conta como configurada', () => {
    process.env.BILLING_INFINITEPAY_TAG = '   '
    expect(trilhosDisponiveis().habilitado).toBe(false)
  })

  it('os dois configurados → os dois oferecidos', () => {
    process.env.ABACATEPAY_PIX_ONE_TIME = 'true'
    process.env.ABACATEPAY_API_KEY = 'abc_dev_x'
    process.env.BILLING_INFINITEPAY_TAG = 'lemonmeet'
    expect(trilhosDisponiveis().trilhos).toEqual(['pix', 'card'])
  })
})
