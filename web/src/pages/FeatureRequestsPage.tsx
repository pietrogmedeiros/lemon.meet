import { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { 
  Lightbulb, Plus, ThumbsUp, MessageCircle, Loader, 
  CheckCircle, Clock, AlertCircle, XCircle, Calendar,
  TrendingUp, User
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface FeatureRequest {
  id: string
  user_id: string
  user_name: string
  user_email: string
  user_avatar_url: string | null
  title: string
  description: string
  category: string | null
  status: 'pending' | 'under-review' | 'planned' | 'in-progress' | 'completed' | 'rejected'
  upvotes_count: number
  comments_count: number
  created_at: string
  updated_at: string
}

const STATUS_CONFIG = {
  'pending': { label: 'Pendente', icon: Clock, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
  'under-review': { label: 'Em Análise', icon: AlertCircle, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
  'planned': { label: 'Planejada', icon: Calendar, color: 'text-purple-500', bg: 'bg-purple-50', border: 'border-purple-200' },
  'in-progress': { label: 'Em Desenvolvimento', icon: TrendingUp, color: 'text-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
  'completed': { label: 'Concluída', icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-200' },
  'rejected': { label: 'Rejeitada', icon: XCircle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
}

export function FeatureRequestsPage() {
  const { session } = useAuth()
  const [requests, setRequests] = useState<FeatureRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<'recent' | 'popular'>('recent')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [userUpvotes, setUserUpvotes] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadRequests()
  }, [sortBy, filterStatus])

  useEffect(() => {
    if (session && requests.length > 0) {
      loadUserUpvotes()
    }
  }, [session, requests])

  const loadRequests = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (filterStatus) params.append('status', filterStatus)
      params.append('sort', sortBy)

      const response = await fetch(`${API}/api/feature-requests?${params}`)
      if (response.ok) {
        const data = await response.json()
        setRequests(data.requests || [])
      }
    } catch (error) {
      console.error('Erro ao carregar sugestões:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadUserUpvotes = async () => {
    if (!session) return

    try {
      const upvotePromises = requests.map(req => 
        fetch(`${API}/api/feature-requests/${req.id}/user-upvote`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
      )

      const responses = await Promise.all(upvotePromises)
      const upvotedIds = new Set<string>()

      for (let i = 0; i < responses.length; i++) {
        if (responses[i].ok) {
          const data = await responses[i].json()
          if (data.hasUpvoted) {
            upvotedIds.add(requests[i].id)
          }
        }
      }

      setUserUpvotes(upvotedIds)
    } catch (error) {
      console.error('Erro ao carregar upvotes:', error)
    }
  }

  const handleUpvote = async (requestId: string) => {
    if (!session) return

    const hasUpvoted = userUpvotes.has(requestId)

    try {
      const response = await fetch(`${API}/api/feature-requests/${requestId}/upvote`, {
        method: hasUpvoted ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })

      if (response.ok) {
        // Atualiza estado local
        setUserUpvotes(prev => {
          const newSet = new Set(prev)
          if (hasUpvoted) {
            newSet.delete(requestId)
          } else {
            newSet.add(requestId)
          }
          return newSet
        })

        // Atualiza contador
        setRequests(prev => prev.map(req => 
          req.id === requestId 
            ? { ...req, upvotes_count: req.upvotes_count + (hasUpvoted ? -1 : 1) }
            : req
        ))
      }
    } catch (error) {
      console.error('Erro ao dar upvote:', error)
    }
  }

  const handleCreateRequest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!session) return

    const formData = new FormData(e.currentTarget)
    const title = formData.get('title') as string
    const description = formData.get('description') as string
    const category = formData.get('category') as string

    try {
      const response = await fetch(`${API}/api/feature-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ title, description, category })
      })

      if (response.ok) {
        setShowCreateModal(false)
        loadRequests()
        ;(e.target as HTMLFormElement).reset()
      }
    } catch (error) {
      console.error('Erro ao criar sugestão:', error)
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

  return (
    <MainLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#2D5A27] to-[#1E3D1A] flex items-center justify-center">
              <Lightbulb className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#333333]">
                Sugestões de Melhorias
              </h1>
              <p className="text-[#666666]">
                Compartilhe suas ideias e vote nas sugestões da comunidade
              </p>
            </div>
          </div>

          {/* Actions bar */}
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#2D5A27] text-white rounded-xl hover:bg-[#1E3D1A] transition font-semibold"
            >
              <Plus size={18} />
              Nova Sugestão
            </button>

            {/* Sort */}
            <div className="flex items-center gap-2 border border-[#E0E0E0] rounded-xl px-3 py-2">
              <span className="text-sm text-[#666666]">Ordenar:</span>
              <button
                onClick={() => setSortBy('recent')}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                  sortBy === 'recent' 
                    ? 'bg-[#2D5A27] text-white' 
                    : 'text-[#666666] hover:bg-[#F5F5F5]'
                }`}
              >
                Recentes
              </button>
              <button
                onClick={() => setSortBy('popular')}
                className={`px-3 py-1 rounded-lg text-sm font-medium transition ${
                  sortBy === 'popular' 
                    ? 'bg-[#2D5A27] text-white' 
                    : 'text-[#666666] hover:bg-[#F5F5F5]'
                }`}
              >
                Populares
              </button>
            </div>

            {/* Filter status */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-4 py-2 border border-[#E0E0E0] rounded-xl text-sm text-[#666666] focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20"
            >
              <option value="">Todos os status</option>
              <option value="pending">Pendente</option>
              <option value="under-review">Em Análise</option>
              <option value="planned">Planejada</option>
              <option value="in-progress">Em Desenvolvimento</option>
              <option value="completed">Concluída</option>
            </select>
          </div>
        </div>

        {/* Lista de sugestões */}
        {requests.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-[#E0E0E0]">
            <Lightbulb className="mx-auto text-[#999999] mb-3" size={48} />
            <p className="text-[#666666]">
              Nenhuma sugestão encontrada. Seja o primeiro a sugerir!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((request) => {
              const statusCfg = STATUS_CONFIG[request.status]
              const StatusIcon = statusCfg.icon
              const hasUpvoted = userUpvotes.has(request.id)

              return (
                <div
                  key={request.id}
                  className="bg-white border border-[#E0E0E0] rounded-2xl p-6 hover:border-[#2D5A27]/30 hover:shadow-md transition-all"
                >
                  <div className="flex gap-4">
                    {/* Upvote button */}
                    <button
                      onClick={() => handleUpvote(request.id)}
                      disabled={!session}
                      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl border-2 transition-all ${
                        hasUpvoted
                          ? 'border-[#2D5A27] bg-[#2D5A27]/5 text-[#2D5A27]'
                          : 'border-[#E0E0E0] hover:border-[#2D5A27]/30 text-[#666666]'
                      } ${!session ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <ThumbsUp size={20} fill={hasUpvoted ? 'currentColor' : 'none'} />
                      <span className="text-sm font-bold">{request.upvotes_count}</span>
                    </button>

                    {/* Content */}
                    <div className="flex-1">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="text-lg font-bold text-[#333333] mb-2">
                            {request.title}
                          </h3>
                          <div className="flex items-center gap-3 text-sm text-[#999999]">
                            <div className="flex items-center gap-2">
                              {request.user_avatar_url ? (
                                <img 
                                  src={request.user_avatar_url} 
                                  alt={request.user_name}
                                  className="w-5 h-5 rounded-full"
                                />
                              ) : (
                                <div className="w-5 h-5 rounded-full bg-[#2D5A27]/10 flex items-center justify-center">
                                  <User size={12} className="text-[#2D5A27]" />
                                </div>
                              )}
                              <span>{request.user_name}</span>
                            </div>
                            <span>•</span>
                            <span>
                              {formatDistanceToNow(new Date(request.created_at), { 
                                addSuffix: true, 
                                locale: ptBR 
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Status badge */}
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${statusCfg.bg} ${statusCfg.border}`}>
                          <StatusIcon size={14} className={statusCfg.color} />
                          <span className={`text-xs font-semibold ${statusCfg.color}`}>
                            {statusCfg.label}
                          </span>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-[#666666] leading-relaxed mb-4">
                        {request.description}
                      </p>

                      {/* Footer */}
                      <div className="flex items-center gap-4 text-sm text-[#999999]">
                        <div className="flex items-center gap-1.5">
                          <MessageCircle size={16} />
                          <span>{request.comments_count} comentários</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal de criar sugestão */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6">
            <h2 className="text-2xl font-bold text-[#333333] mb-4">
              Nova Sugestão
            </h2>

            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#333333] mb-2">
                  Título *
                </label>
                <input
                  type="text"
                  name="title"
                  required
                  maxLength={200}
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20"
                  placeholder="Resuma sua sugestão em uma frase"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#333333] mb-2">
                  Descrição *
                </label>
                <textarea
                  name="description"
                  required
                  maxLength={5000}
                  rows={6}
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20 resize-none"
                  placeholder="Descreva detalhadamente sua sugestão..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#333333] mb-2">
                  Categoria (opcional)
                </label>
                <select
                  name="category"
                  className="w-full px-4 py-2.5 border border-[#E0E0E0] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/20"
                >
                  <option value="">Selecione...</option>
                  <option value="feature">Nova funcionalidade</option>
                  <option value="improvement">Melhoria</option>
                  <option value="integration">Integração</option>
                  <option value="bug">Correção de bug</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-6 py-2.5 border border-[#E0E0E0] text-[#666666] rounded-xl hover:bg-[#F5F5F5] transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-[#2D5A27] text-white rounded-xl hover:bg-[#1E3D1A] transition font-semibold"
                >
                  Publicar Sugestão
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </MainLayout>
  )
}
