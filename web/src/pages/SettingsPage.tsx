import { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { supabase } from '@/lib/supabase'
import { User, Lock, CheckCircle, AlertCircle, Loader, KeyRound, Mail, Shield } from 'lucide-react'

export function SettingsPage() {
  const { user } = useAuth()

  // --- Modo de recuperação de senha (vindo do link do e-mail) ---
  const [isRecovery, setIsRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [recoveryError, setRecoveryError] = useState('')

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSetNewPassword = async () => {
    setRecoveryError('')
    if (!newPassword || newPassword.length < 6) {
      setRecoveryError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setRecoveryError('As senhas não coincidem.')
      return
    }
    setRecoveryStatus('loading')
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setRecoveryStatus('success')
      setIsRecovery(false)
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setRecoveryError(err.message ?? 'Erro ao atualizar senha.')
      setRecoveryStatus('error')
    }
  }

  // --- Nome ---
  const [displayName, setDisplayName] = useState(
    user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? ''
  )
  const [nameStatus, setNameStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [nameError, setNameError] = useState('')

  const handleSaveName = async () => {
    if (!displayName.trim()) {
      setNameError('O nome não pode estar vazio.')
      return
    }
    setNameError('')
    setNameStatus('loading')
    try {
      const { error } = await supabase.auth.updateUser({ data: { full_name: displayName.trim() } })
      if (error) throw error
      setNameStatus('success')
      setTimeout(() => setNameStatus('idle'), 3000)
    } catch (err: any) {
      setNameError(err.message ?? 'Erro ao salvar nome.')
      setNameStatus('error')
    }
  }

  // --- Redefinição de senha ---
  const [pwStatus, setPwStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [pwError, setPwError] = useState('')

  const handleResetPassword = async () => {
    if (!user?.email) return
    setPwError('')
    setPwStatus('loading')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/settings`,
      })
      if (error) throw error
      setPwStatus('sent')
    } catch (err: any) {
      setPwError(err.message ?? 'Erro ao enviar e-mail.')
      setPwStatus('error')
    }
  }

  const initials = (displayName || user?.email || '?')
    .split(' ')
    .map((p: string) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <MainLayout>
      <div className="space-y-6">

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-[#333333]">Configurações</h1>
          <p className="mt-1 text-sm text-[#666666]">Gerencie sua conta e preferências.</p>
        </div>

        {/* Card de nova senha — aparece somente quando vem do link do e-mail */}
        {isRecovery && (
          <section className="bg-white border-2 border-[#2D5A27] rounded-2xl p-6 shadow-sm space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#2D5A27]/10 flex items-center justify-center">
                <KeyRound size={20} className="text-[#2D5A27]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#333333]">Definir nova senha</h2>
                <p className="text-xs text-[#666666]">Você veio do link de redefinição. Escolha uma nova senha.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">Nova senha</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition placeholder:text-[#999]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">Confirmar senha</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita a senha"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition placeholder:text-[#999]"
                />
              </div>
            </div>
            {recoveryError && (
              <p className="text-xs text-[#DC3545] flex items-center gap-1.5">
                <AlertCircle size={13} /> {recoveryError}
              </p>
            )}
            {recoveryStatus === 'success' && (
              <p className="text-xs text-[#4CAF50] flex items-center gap-1.5 font-medium">
                <CheckCircle size={13} /> Senha atualizada com sucesso!
              </p>
            )}
            <button
              onClick={handleSetNewPassword}
              disabled={recoveryStatus === 'loading'}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#2D5A27] text-white text-sm font-semibold hover:bg-[#1E3D1A] transition disabled:opacity-50 shadow-sm"
            >
              {recoveryStatus === 'loading' && <Loader size={15} className="animate-spin" />}
              Salvar nova senha
            </button>
          </section>
        )}

        {/* Layout 2 colunas */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── Coluna esquerda: Perfil ── */}
          <section className="bg-white border border-[#E0E0E0] rounded-2xl shadow-sm overflow-hidden">
            {/* Banner com avatar */}
            <div className="bg-gradient-to-br from-[#2D5A27]/8 to-[#2D5A27]/3 px-6 pt-7 pb-6 border-b border-[#F0F0F0]">
              <div className="flex items-center gap-5">
                <div className="w-20 h-20 rounded-2xl bg-[#2D5A27]/20 flex items-center justify-center text-2xl font-bold text-[#2D5A27] shrink-0 select-none shadow-sm">
                  {initials}
                </div>
                <div>
                  <p className="text-lg font-bold text-[#333333]">{displayName || 'Sem nome'}</p>
                  <p className="text-sm text-[#666666] flex items-center gap-1.5 mt-1">
                    <Mail size={13} /> {user?.email}
                  </p>
                  <p className="text-xs text-[#999999] mt-1">
                    Membro desde {new Date(user?.created_at ?? '').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Campos */}
            <div className="p-6 space-y-5">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                  <User size={14} className="text-[#2D5A27]" />
                </div>
                <span className="text-sm font-semibold text-[#333333]">Informações da conta</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">E-mail</label>
                <input
                  type="email"
                  value={user?.email ?? ''}
                  disabled
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] bg-[#F5F5F5] text-[#999999] text-sm cursor-not-allowed"
                />
                <p className="text-xs text-[#BBBBBB]">O e-mail não pode ser alterado.</p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">Nome de exibição</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  placeholder="Seu nome"
                  className="w-full px-4 py-2.5 rounded-xl border border-[#E0E0E0] text-[#333333] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2D5A27]/25 focus:border-[#2D5A27] transition placeholder:text-[#999]"
                />
                {nameError && (
                  <p className="text-xs text-[#DC3545] flex items-center gap-1.5">
                    <AlertCircle size={13} /> {nameError}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={handleSaveName}
                  disabled={nameStatus === 'loading'}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-sm ${
                    nameStatus === 'success'
                      ? 'bg-[#4CAF50] text-white'
                      : 'bg-[#2D5A27] text-white hover:bg-[#1E3D1A] disabled:opacity-50'
                  }`}
                >
                  {nameStatus === 'loading' && <Loader size={15} className="animate-spin" />}
                  {nameStatus === 'success' && <CheckCircle size={15} />}
                  {nameStatus === 'success' ? 'Salvo!' : 'Salvar nome'}
                </button>
                {nameStatus === 'success' && (
                  <span className="text-xs text-[#4CAF50] font-medium">Alterações salvas.</span>
                )}
              </div>
            </div>
          </section>

          {/* ── Coluna direita ── */}
          <div className="space-y-6">

            {/* Segurança */}
            <section className="bg-white border border-[#E0E0E0] rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-gradient-to-br from-slate-50 to-white px-6 pt-6 pb-5 border-b border-[#F0F0F0]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                    <Shield size={14} className="text-[#2D5A27]" />
                  </div>
                  <span className="text-sm font-semibold text-[#333333]">Segurança</span>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex items-start gap-3 bg-[#F8F9FA] rounded-xl p-4 border border-[#F0F0F0]">
                  <Lock size={16} className="text-[#666666] mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm text-[#333333] font-medium">Redefinir senha</p>
                    <p className="text-xs text-[#666666] mt-0.5 leading-relaxed">
                      Enviaremos um e-mail de redefinição para{' '}
                      <span className="font-semibold text-[#333333]">{user?.email}</span>.
                    </p>
                  </div>
                </div>

                {pwStatus === 'sent' ? (
                  <div className="flex items-center gap-2 text-sm text-[#4CAF50] font-medium bg-green-50 border border-green-200 px-4 py-3 rounded-xl">
                    <CheckCircle size={16} />
                    E-mail enviado! Verifique sua caixa de entrada.
                  </div>
                ) : (
                  <>
                    {pwError && (
                      <p className="text-xs text-[#DC3545] flex items-center gap-1.5">
                        <AlertCircle size={13} /> {pwError}
                      </p>
                    )}
                    <button
                      onClick={handleResetPassword}
                      disabled={pwStatus === 'loading'}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[#2D5A27] text-[#2D5A27] text-sm font-semibold hover:bg-[#2D5A27]/5 transition disabled:opacity-50"
                    >
                      {pwStatus === 'loading' && <Loader size={15} className="animate-spin" />}
                      Enviar link de redefinição
                    </button>
                  </>
                )}
              </div>
            </section>

            {/* Sessão / informações extras */}
            <section className="bg-white border border-[#E0E0E0] rounded-2xl shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#2D5A27]/10 flex items-center justify-center">
                  <User size={14} className="text-[#2D5A27]" />
                </div>
                <span className="text-sm font-semibold text-[#333333]">Informações da sessão</span>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-[#F5F5F5]">
                  <span className="text-xs text-[#666666]">ID do usuário</span>
                  <span className="text-xs font-mono text-[#999999] truncate max-w-[180px]">{user?.id?.slice(0, 18)}…</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#F5F5F5]">
                  <span className="text-xs text-[#666666]">Provedor</span>
                  <span className="text-xs font-medium text-[#333333] capitalize">
                    {user?.app_metadata?.provider ?? 'email'}
                  </span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-xs text-[#666666]">Último acesso</span>
                  <span className="text-xs text-[#333333]">
                    {user?.last_sign_in_at
                      ? new Date(user.last_sign_in_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
                      : '—'}
                  </span>
                </div>
              </div>
            </section>

          </div>
        </div>

      </div>
    </MainLayout>
  )
}
