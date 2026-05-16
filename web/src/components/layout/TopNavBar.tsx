import { Lightbulb } from 'lucide-react'
import { useAuth, useSubscription } from '@/contexts'
import { NotificationBell } from './NotificationBell'
import { useNavigate } from 'react-router-dom'

const PLAN_CONFIG: Record<string, { label: string; cls: string }> = {
  trial:        { label: 'Trial', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  starter:      { label: 'Starter', cls: 'bg-[#2D5A27]/8 text-[#2D5A27] border-[#2D5A27]/20' },
  professional: { label: 'Professional', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
}

export function TopNavBar() {
  const { user } = useAuth()
  const { subscription, loading: subLoading } = useSubscription()
  const navigate = useNavigate()

  return (
    <header className="h-16 bg-white border-b border-neutral-light px-8 flex items-center justify-between sticky top-0 z-40">
      {/* Left: tagline sutil */}
      <p className="text-[12px] text-[#2D5A27] font-semibold tracking-wide select-none hidden sm:block">
        Esprema o melhor das suas reuniões
      </p>

      {/* Right: Plan badge, Language, Profile */}
      <div className="flex items-center gap-3">

        {/* Plan badge */}
        {!subLoading && subscription && (() => {
          const cfg = PLAN_CONFIG[subscription.plan]
          return cfg ? (
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>
              {cfg.label}
            </span>
          ) : null
        })()}
        
        {/* Notification Bell */}
        <NotificationBell />
        
        {/* Sugestões de Melhorias */}
        <button
          onClick={() => navigate('/feature-requests')}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-neutral-mid hover:text-primary hover:bg-primary/5 transition-all duration-200"
          title="Sugerir melhorias"
        >
          <Lightbulb size={20} />
        </button>

        {/* User Profile */}
        {user?.user_metadata?.avatar_url ? (
          <img
            src={user.user_metadata.avatar_url}
            alt={user.user_metadata.full_name || 'Perfil'}
            className="w-10 h-10 rounded-full object-cover cursor-pointer ring-2 ring-primary/20 hover:ring-primary transition-all"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center text-accent font-bold font-display cursor-pointer">
            {user?.email?.[0]?.toUpperCase() || 'L'}
          </div>
        )}
      </div>
    </header>
  )
}
