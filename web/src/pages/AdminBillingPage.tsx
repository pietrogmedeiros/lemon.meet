// ============================================================
// AdminBillingPage.tsx — Comprovação de uso para faturamento
//
// POR QUE EXISTE: clientes como a Starbem pagam por ACESSO (assento) e só
// liberam a nota mediante prova de que as pessoas usaram o produto. Isso era
// levantado na mão, todo mês, direto no banco.
//
// Acesso: só pietrogoncalvesmedeiros@gmail.com (allowlist no front E no
// backend). NÃO usa mais chave manual — a conta do Supabase é o fator.
//
// Backend: GET /api/admin/billing?month=YYYY-MM&teamId=<uuid|all>
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { MainLayout } from '@/components/layout'

const API = import.meta.env.VITE_API_URL
const ALLOWLIST = new Set(['pietrogoncalvesmedeiros@gmail.com'])

const VERDE = '#2D5A27'
const AMARELO = '#FFD700'

type Usuario = {
  userId: string
  email: string
  nome: string
  reunioes: number
  gravadas: number
  minutos: number
  minutosIncompletos: boolean
  primeira: string | null
  ultima: string | null
  interno: boolean
}

type Resposta = {
  month: string
  teamId: string
  teams: { id: string; name: string }[]
  usuarios: Usuario[]
  alertas: { email: string; reunioes: number; gravadas: number; motivo: string }[]
  totais: {
    acessosFaturaveis: number
    usuariosComAtividade: number
    reunioes: number
    reunioesDistintas: number
    gravadas: number
    minutos: number
  }
}

function mesAtual(): string {
  const agora = new Date()
  const brt = new Date(agora.getTime() - 3 * 3600_000)
  return `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}`
}

function nomeDoMes(m: string): string {
  const [ano, mes] = m.split('-')
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${nomes[Number(mes) - 1] ?? mes} de ${ano}`
}

function dia(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(new Date(iso).getTime() - 3 * 3600_000)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Nome de time -> pedaço seguro de nome de arquivo.
 * "Starbem.app" -> "starbem" | "Comercial Foozi" -> "comercial-foozi"
 */
function apelidoCliente(nome: string): string {
  return nome
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento
    .replace(/\.(app|com|com\.br|io|net)$/i, '')        // tira TLD do nome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function AdminBillingPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [mes, setMes] = useState(mesAtual())
  const [teamId, setTeamId] = useState('all')
  const [preco, setPreco] = useState(119.9)
  const [dados, setDados] = useState<Resposta | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [gerando, setGerando] = useState(false)
  const faturaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return
      const s = data.session
      if (!s) { navigate('/login'); return }
      setEmail(s.user.email ?? null)
      setToken(s.access_token)
    })
    return () => { vivo = false }
  }, [navigate])

  const permitido = email ? ALLOWLIST.has(email) : false

  const buscar = useCallback(async () => {
    if (!token || !permitido) return
    setCarregando(true); setErro(null)
    try {
      const res = await fetch(`${API}/api/admin/billing?month=${mes}&teamId=${teamId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detalhe || body?.error || `HTTP ${res.status}`)
      setDados(body)
    } catch (e: any) {
      setErro(String(e?.message ?? e))
      setDados(null)
    } finally {
      setCarregando(false)
    }
  }, [token, permitido, mes, teamId])

  useEffect(() => { void buscar() }, [buscar])

  const faturaveis = useMemo(
    () => (dados?.usuarios ?? []).filter((u) => u.gravadas > 0 && !u.interno),
    [dados],
  )
  const total = faturaveis.length * preco
  const nomeTime = dados?.teams.find((t) => t.id === teamId)?.name ?? 'Todos os times'

  async function gerarPdf() {
    if (!faturaRef.current) return
    setGerando(true)
    try {
      const { default: html2pdf } = await import('html2pdf.js')
      await html2pdf().set({
        margin: [10, 10, 10, 10] as [number, number, number, number],
        // `invoiced_<mês>_<cliente>.pdf`. O mês em YYYY-MM ordena sozinho na
        // pasta; o cliente evita que a fatura da Foozi sobrescreva a da Starbem
        // no mesmo mês, já que ambas cairiam no mesmo nome sem isso.
        filename: `invoiced_${mes}${teamId === 'all' ? '' : `_${apelidoCliente(nomeTime)}`}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      }).from(faturaRef.current).save()
    } catch (e: any) {
      setErro(`Falha ao gerar o PDF: ${e?.message ?? e}`)
    } finally {
      setGerando(false)
    }
  }

  if (email && !permitido) {
    return (
      <MainLayout><div className="p-8">
        <h1 className="text-xl font-semibold text-primary">Acesso restrito</h1>
        <p className="text-neutral-mid mt-2">Esta área é interna.</p>
      </div></MainLayout>
    )
  }

  return (
    <MainLayout>
    <div className="p-6 max-w-[1100px] mx-auto">
      <h1 className="text-2xl font-bold text-primary">Comprovação de uso</h1>
      <p className="text-neutral-mid mt-1 mb-6">
        Relatório por pessoa para faturar clientes que pagam por acesso.
      </p>

      {/* ── Filtros ─────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-4 items-end bg-surface border border-neutral-light rounded-xl p-4 mb-6">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-mid">Mês</span>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)}
            className="border border-neutral-light rounded-lg px-3 py-2 bg-background" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-mid">Time</span>
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
            className="border border-neutral-light rounded-lg px-3 py-2 bg-background min-w-[200px]">
            <option value="all">Todos os times</option>
            {dados?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-mid">Preço por acesso</span>
          <input type="number" step="0.01" min="0" value={preco}
            onChange={(e) => setPreco(Number(e.target.value))}
            className="border border-neutral-light rounded-lg px-3 py-2 bg-background w-36" />
        </label>
        <button onClick={() => void buscar()} disabled={carregando}
          className="px-4 py-2 rounded-lg bg-primary text-white disabled:opacity-50">
          {carregando ? 'Carregando…' : 'Atualizar'}
        </button>
        <button onClick={() => void gerarPdf()} disabled={!dados || gerando || faturaveis.length === 0}
          className="px-4 py-2 rounded-lg font-semibold disabled:opacity-50"
          style={{ background: AMARELO, color: VERDE }}>
          {gerando ? 'Gerando…' : 'Baixar PDF'}
        </button>
      </div>

      {erro && (
        <div className="mb-6 p-4 rounded-lg border border-danger/40 bg-danger/5 text-danger text-sm">{erro}</div>
      )}

      {dados && dados.alertas?.length > 0 && (
        <div className="mb-6 p-4 rounded-lg border border-accent bg-accent/10 text-sm">
          <div className="font-semibold mb-1">Possível cobrança a menos</div>
          <p className="text-neutral-mid mb-2">
            Estas pessoas têm o mesmo domínio de e-mail do time, tiveram reuniões no mês,
            mas estão fora do filtro — provavelmente sem time atribuído:
          </p>
          <ul className="list-disc ml-5">
            {dados.alertas.map((a) => (
              <li key={a.email}>
                <strong>{a.email}</strong> — {a.gravadas} gravada(s) de {a.reunioes} reunião(ões)
              </li>
            ))}
          </ul>
        </div>
      )}

      {dados && (dados.usuarios ?? []).some((u) => u.interno && u.gravadas > 0) && (
        <div className="mb-6 p-3 rounded-lg border border-neutral-light bg-neutral-lighter text-xs text-neutral-mid">
          Contas internas com uso no período foram <strong>excluídas da fatura</strong> — não se cobra o cliente
          pelo nosso próprio acesso.
        </div>
      )}

      {dados && faturaveis.length === 0 && !carregando && (
        <div className="p-6 text-neutral-mid">
          Ninguém teve reunião gravada em {nomeDoMes(mes)} neste filtro. Sem uso, não há o que faturar.
        </div>
      )}

      {/* ── A fatura: é exatamente isto que vira PDF ─────────── */}
      {dados && faturaveis.length > 0 && (
        <div ref={faturaRef} style={{ background: '#fff', color: '#1a1a1a', padding: 32, fontFamily: 'Helvetica, Arial, sans-serif' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `3px solid ${VERDE}`, paddingBottom: 16 }}>
            <div>
              {/* ⚠️ Largura E altura explícitas, na proporção real do arquivo
                  (568×300 ≈ 1,89:1). O html2canvas — que o html2pdf usa por
                  baixo — NÃO respeita `object-fit`, então uma caixa quadrada
                  esticava o logo no PDF mesmo aparecendo certo na tela.
                  O arquivo já traz o nome "Lemon.meet", então não repetimos em
                  texto ao lado. */}
              <img src="/lemon.meet.png" alt="Lemon.meet" width={132} height={70}
                style={{ width: 132, height: 70, display: 'block' }} />
              <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                Meeting Intelligence
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, letterSpacing: 1, color: '#888', textTransform: 'uppercase' }}>Relatório de uso</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: VERDE }}>{nomeDoMes(mes)}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{nomeTime}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
            {[
              { r: 'Acessos faturáveis', v: String(faturaveis.length), destaque: true },
              { r: 'Reuniões gravadas', v: String(dados.totais.gravadas) },
              { r: 'Minutos registrados', v: dados.totais.minutos.toLocaleString('pt-BR') },
            ].map((c) => (
              <div key={c.r} style={{
                flex: 1, border: `1px solid ${c.destaque ? VERDE : '#e5e5e5'}`,
                background: c.destaque ? '#f4f9f3' : '#fff',
                borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ fontSize: 10, color: '#777', textTransform: 'uppercase', letterSpacing: 0.5 }}>{c.r}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: c.destaque ? VERDE : '#222' }}>{c.v}</div>
              </div>
            ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: VERDE, color: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '9px 10px' }}>Usuário</th>
                <th style={{ textAlign: 'right', padding: '9px 10px' }}>Gravadas</th>
                <th style={{ textAlign: 'right', padding: '9px 10px' }}>Minutos</th>
                <th style={{ textAlign: 'center', padding: '9px 10px' }}>Período</th>
              </tr>
            </thead>
            <tbody>
              {faturaveis.map((u, i) => (
                <tr key={u.userId} style={{ background: i % 2 ? '#fafafa' : '#fff', borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600 }}>{u.nome}</div>
                    <div style={{ color: '#777', fontSize: 11 }}>{u.email}</div>
                  </td>
                  <td style={{ textAlign: 'right', padding: '8px 10px', fontWeight: 700, color: VERDE }}>{u.gravadas}</td>
                  <td style={{ textAlign: 'right', padding: '8px 10px' }}>
                    {u.minutos}{u.minutosIncompletos ? '*' : ''}
                  </td>
                  <td style={{ textAlign: 'center', padding: '8px 10px', color: '#555' }}>
                    {dia(u.primeira)} – {dia(u.ultima)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
            <table style={{ fontSize: 13, borderCollapse: 'collapse', minWidth: 320 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '6px 12px', color: '#555' }}>Acessos faturáveis</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right' }}>{faturaveis.length}</td>
                </tr>
                <tr>
                  <td style={{ padding: '6px 12px', color: '#555' }}>Preço por acesso</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right' }}>{brl(preco)}</td>
                </tr>
                <tr style={{ borderTop: `2px solid ${VERDE}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, color: VERDE, fontSize: 15 }}>Total</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: VERDE, fontSize: 15 }}>{brl(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* A régua do relatório, impressa junto: quem recebe precisa saber o
              que foi contado, senão a conversa de cobrança vira discussão. */}
          <div style={{ marginTop: 24, paddingTop: 12, borderTop: '1px solid #e5e5e5', fontSize: 10, color: '#777', lineHeight: 1.6 }}>
            <div><strong>Como este relatório é apurado</strong></div>
            <div>• <strong>Acesso faturável</strong>: pessoa com ao menos uma reunião <strong>gravada com sucesso</strong> no mês. Quem teve só tentativas frustradas não é cobrado.</div>
            <div>• <strong>Minutos</strong>: calculados por início e fim da gravação. Valores com <strong>*</strong> são parciais — parte das reuniões não registrou o horário de término.</div>
            <div>• Período apurado em horário de Brasília, de {nomeDoMes(mes)}.</div>
            <div style={{ marginTop: 8, color: '#999' }}>Emitido em {new Date().toLocaleDateString('pt-BR')} · Lemon.meet</div>
          </div>
        </div>
      )}
    </div>
    </MainLayout>
  )
}
