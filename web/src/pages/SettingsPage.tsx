import { useState } from 'react'
import { MainLayout } from '@/components/layout'
import { useAuth } from '@/contexts'
import { supabase } from '@/lib/supabase'
import { User, Lock, CheckCircle, AlertCircle, Loader } from 'lucide-react'

export function SettingsPage() {
  const { user } = useAuth()

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
