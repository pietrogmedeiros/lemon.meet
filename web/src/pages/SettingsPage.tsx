import { useState, useEffect } from 'react'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { supabase } from '@/lib/supabase'
import { User, Lock, CheckCircle, AlertCircle, Loader, KeyRound } from 'lucide-react'

export function SettingsPage() {
  const { user } = useAuth()

  // --- Modo de recuperação de senha (vindo do link do e-mail) ---
  const [isRecovery, setIsRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [recoveryError, setRecoveryError] = useState('')

  useEffect(() => {
    // Supabase injeta o token na hash quando o usuário vem do link de redefinição
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
      }
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
      const { error } = await supabase.auth.updateUser({
        data: { full_name: displayName.trim() },
      })
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

  return (
    <MainLayout>
      <div className="max-w-xl space-y-8">
        <div>
          <h1 className="text-headline-1 text-primary">Configurações</h1>
          <p className="mt-1 text-body-large text-secondary">Gerencie sua conta e preferências.</p>
        </div>

        {/* Card de nova senha — aparece somente quando vem do link do e-mail */}
        {isRecovery && (
          <section className="bg-white border-2 border-primary rounded-2xl p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <KeyRound size={18} className="text-primary" />
              </div>
              <div>
                <h2 className="text-body-large font-semibold text-primary">Definir nova senha</h2>
                <p className="text-xs text-secondary">Você veio do link de redefinição. Escolha uma nova senha.</p>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">Nova senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-light bg-white text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-secondary uppercase tracking-wide">Confirmar senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                className="w-full px-4 py-2.5 rounded-xl border border-neutral-light bg-white text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
              />
            </div>

            {recoveryError && (
              <p className="text-xs text-danger flex items-center gap-1">
                <AlertCircle size={12} /> {recoveryError}
              </p>
            )}

            {recoveryStatus === 'success' && (
              <p className="text-xs text-success flex items-center gap-1">
                <CheckCircle size={12} /> Senha atualizada com sucesso!
              </p>
            )}

            <button
              onClick={handleSetNewPassword}
              disabled={recoveryStatus === 'loading'}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition disabled:opacity-60"
            >
              {recoveryStatus === 'loading' && <Loader size={15} className="animate-spin" />}
              Salvar nova senha
            </button>
          </section>
        )}

        {/* Perfil */}
        <section className="bg-white border border-neutral-light rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <User size={18} className="text-primary" />
            </div>
            <h2 className="text-body-large font-semibold text-primary">Perfil</h2>
          </div>

          {/* E-mail (somente leitura) */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide">
              E-mail
            </label>
            <input
              type="email"
              value={user?.email ?? ''}
              disabled
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-light bg-neutral-lighter text-secondary text-sm cursor-not-allowed"
            />
          </div>

          {/* Nome */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-secondary uppercase tracking-wide">
              Nome de exibição
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              placeholder="Seu nome"
              className="w-full px-4 py-2.5 rounded-xl border border-neutral-light bg-white text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
            {nameError && (
              <p className="text-xs text-danger flex items-center gap-1">
                <AlertCircle size={12} /> {nameError}
              </p>
            )}
          </div>

          <button
            onClick={handleSaveName}
            disabled={nameStatus === 'loading'}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition disabled:opacity-60"
          >
            {nameStatus === 'loading' ? (
              <Loader size={15} className="animate-spin" />
            ) : nameStatus === 'success' ? (
              <CheckCircle size={15} />
            ) : null}
            {nameStatus === 'success' ? 'Salvo!' : 'Salvar nome'}
          </button>
        </section>

        {/* Segurança */}
        <section className="bg-white border border-neutral-light rounded-2xl p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Lock size={18} className="text-primary" />
            </div>
            <h2 className="text-body-large font-semibold text-primary">Segurança</h2>
          </div>

          <p className="text-sm text-secondary">
            Enviaremos um link de redefinição de senha para{' '}
            <span className="font-medium text-primary">{user?.email}</span>.
          </p>

          {pwStatus === 'sent' ? (
            <div className="flex items-center gap-2 text-sm text-success font-medium">
              <CheckCircle size={16} />
              E-mail enviado! Verifique sua caixa de entrada.
            </div>
          ) : (
            <>
              {pwError && (
                <p className="text-xs text-danger flex items-center gap-1">
                  <AlertCircle size={12} /> {pwError}
                </p>
              )}
              <button
                onClick={handleResetPassword}
                disabled={pwStatus === 'loading'}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary text-primary text-sm font-medium hover:bg-primary/5 transition disabled:opacity-60"
              >
                {pwStatus === 'loading' && <Loader size={15} className="animate-spin" />}
                Enviar link de redefinição
              </button>
            </>
          )}
        </section>
      </div>
    </MainLayout>
  )
}
