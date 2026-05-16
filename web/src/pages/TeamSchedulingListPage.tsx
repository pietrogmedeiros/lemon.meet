import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { Loader, Calendar, ArrowRight, Users } from 'lucide-react'

interface Team {
  id: string
  name: string
  isOwner: boolean
  member_count?: number
}

export function TeamSchedulingListPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadTeams()
  }, [session])

  const loadTeams = async () => {
    if (!session) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch('https://lemon-meet-production.up.railway.app/api/teams', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      })

      if (response.ok) {
        const data = await response.json()
        // Filtra apenas times onde o usuário é owner
        const ownerTeams = data.teams?.filter((t: Team) => t.isOwner) ?? []
        setTeams(ownerTeams)
        
        // Se tem apenas 1 time, redireciona automaticamente
        if (ownerTeams.length === 1) {
          navigate(`/teams/${ownerTeams[0].id}/scheduling`, { replace: true })
        }
      }
    } catch (error) {
      console.error('Erro ao carregar times:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-96">
          <Loader className="animate-spin text-[#2D5A27]" size={48} />
        </div>
      </MainLayout>
    )
  }

  if (teams.length === 0) {
    return (
      <MainLayout>
        <div className="max-w-2xl mx-auto mt-12 px-6">
          <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-[#FFF3CD] flex items-center justify-center mx-auto mb-6">
              <Calendar className="text-[#856404]" size={40} />
            </div>
            <h1 className="text-2xl font-bold text-[#333333] mb-3">
              Nenhum time encontrado
            </h1>
            <p className="text-[#666666] mb-8">
              Você precisa ser owner de um time para configurar agendamento Round Robin.
            </p>
            <button
              onClick={() => navigate('/team')}
              className="px-6 py-3 rounded-xl bg-[#2D5A27] text-white font-semibold hover:bg-[#1E3D1A] transition"
            >
              Ir para Meu Time
            </button>
          </div>
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#333333] mb-2">
            Router - Agendamento Automático
          </h1>
          <p className="text-[#666666]">
            Selecione um time para configurar o agendamento Round Robin
          </p>
        </div>

        {/* Lista de times */}
        <div className="grid gap-4">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => navigate(`/teams/${team.id}/scheduling`)}
              className="bg-white border border-[#E0E0E0] rounded-2xl p-6 hover:border-[#2D5A27] hover:shadow-md transition-all group text-left"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-14 h-14 rounded-2xl bg-[#2D5A27]/10 flex items-center justify-center shrink-0">
                    <Users size={26} className="text-[#2D5A27]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-[#333333] mb-1">
                      {team.name}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-[#666666]">
                      <Users size={14} />
                      <span>{team.member_count || 0} membros</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#2D5A27]/10 text-[#2D5A27] text-xs font-semibold">
                        Owner
                      </span>
                    </div>
                  </div>
                </div>
                <ArrowRight 
                  size={20} 
                  className="text-[#999999] group-hover:text-[#2D5A27] group-hover:translate-x-1 transition-all" 
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </MainLayout>
  )
}
