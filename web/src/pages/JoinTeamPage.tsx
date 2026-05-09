import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Users, Loader, CheckCircle, AlertCircle } from 'lucide-react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export function JoinTeamPage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<any>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [teamName, setTeamName] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    console.log('[JoinTeam] 🔍 Verificando sessão...')
    console.log('[JoinTeam] Token do convite:', token)
    
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      if (s) {
        console.log('[JoinTeam] ✅ Sessão encontrada, processando convite diretamente')
        joinTeam(s)
      } else {
        console.log('[JoinTeam] ❌ Sem sessão, usuário precisa fazer login')
      }
    })
  }, [])

  const joinTeam = async (session: any) => {
    if (!token) {
      setStatus('error')
      setErrorMessage('Link inválido')
      return
    }

    try {
      const res = await fetch(`${API}/api/teams/join/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      const data = await res.json()

      if (!data.success) {
        setStatus('error')
        setErrorMessage(data.message || 'Erro ao entrar no time')
        return
      }

      setStatus('success')
      setTeamName(data.team.name)

      // Redireciona após 2 segundos e força reload da página
      setTimeout(() => {
        window.location.href = '/team?joined=true'
      }, 2000)
    } catch (err: any) {
      setStatus('error')
      setErrorMessage(err.message || 'Erro ao processar convite')
    }
  }

  const handleLogin = () => {
    if (!token) {
      console.error('[JoinTeam] ❌ Token não disponível!');
      return;
    }
    
    console.log('[JoinTeam] 💾 Salvando token no localStorage:', token);
    // Salva o token para processar após login
    localStorage.setItem('pending_team_join', token);
    
    // Verifica se salvou
    const saved = localStorage.getItem('pending_team_join');
    console.log('[JoinTeam] ✅ Token salvo com sucesso?', saved === token);
    console.log('[JoinTeam] 📦 Conteúdo salvo:', saved);
    
    // Redireciona para login com ?next=/dashboard explícito
    console.log('[JoinTeam] 🔄 Redirecionando para /login?next=/dashboard');
    navigate('/login?next=/dashboard');
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F5F7FA] to-[#E8EFF5] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center mx-auto">
            <Users size={32} className="text-[#2D5A27]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#333333]">Convite para Time</h1>
            <p className="text-sm text-[#666666] mt-2">
              Você foi convidado para entrar em um time. Faça login para aceitar o convite.
            </p>
          </div>
          <button
            onClick={handleLogin}
            className="w-full py-3 rounded-xl bg-[#2D5A27] text-white font-semibold hover:bg-[#1E3D1A] transition"
          >
            Fazer login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F5F7FA] to-[#E8EFF5] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 text-center space-y-6">
        {status === 'loading' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center mx-auto">
              <Loader size={32} className="text-[#2D5A27] animate-spin" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#333333]">Processando convite...</h1>
              <p className="text-sm text-[#666666] mt-2">
                Aguarde enquanto adicionamos você ao time.
              </p>
            </div>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mx-auto">
              <CheckCircle size={32} className="text-[#4CAF50]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#333333]">Bem-vindo ao time!</h1>
              <p className="text-sm text-[#666666] mt-2">
                Você entrou no time <strong>{teamName}</strong> com sucesso.
              </p>
              <p className="text-xs text-[#999999] mt-3">
                Redirecionando...
              </p>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto">
              <AlertCircle size={32} className="text-[#DC3545]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#333333]">Ops! Algo deu errado</h1>
              <p className="text-sm text-[#666666] mt-2">{errorMessage}</p>
            </div>
            <button
              onClick={() => navigate('/team')}
              className="w-full py-3 rounded-xl border border-[#E0E0E0] text-[#666666] font-semibold hover:bg-[#F8F9FA] transition"
            >
              Voltar para Times
            </button>
          </>
        )}
      </div>
    </div>
  )
}
