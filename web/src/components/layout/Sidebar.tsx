import { useState } from 'react'
import { Home, Video, TrendingUp, LogOut, Settings, ChevronLeft, ChevronRight, Users, CreditCard, Plug, GraduationCap, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts'
import { clsx } from 'clsx'

interface MenuItem {
  id: string
  path: string
  icon: React.ElementType
  label: string
}

interface MenuGroup {
  section?: string
  items: MenuItem[]
}

export function Sidebar() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState(false)

  const groups: MenuGroup[] = [
    {
      items: [
        { id: 'dashboard',    path: '/dashboard',    icon: Home,           label: t('nav.dashboard') },
        { id: 'meetings',     path: '/meetings',     icon: Video,          label: t('nav.meetings') },
        { id: 'insights',     path: '/insights',     icon: TrendingUp,     label: t('nav.insights') },
        { id: 'coaching',     path: '/coaching',     icon: GraduationCap,  label: 'Coaching' },
        { id: 'relatorio',    path: '/relatorio',    icon: FileText,       label: 'Relatório Semanal' },
      ],
    },
    {
      section: 'Conta',
      items: [
        { id: 'team',         path: '/team',         icon: Users,      label: t('nav.team', 'Meu Time') },
        { id: 'integrations', path: '/integrations', icon: Plug,        label: 'Integrações' },
        { id: 'subscription', path: '/subscription', icon: CreditCard, label: 'Minha Assinatura' },
        { id: 'settings',     path: '/settings',     icon: Settings,   label: t('nav.settings', 'Configurações') },
      ],
    },
  ]

  const isActive = (path: string) => {
    if (path === '/meetings') return location.pathname.startsWith('/meetings')
    return location.pathname === path
  }

  const handleLogout = async () => {
    if (window.confirm(t('auth.logout.confirm'))) {
      await signOut()
    }
  }

  return (
    <aside
      className={clsx(
        'h-screen bg-white border-r border-[#E8E8E8] flex flex-col sticky top-0 transition-all duration-300 overflow-hidden',
        expanded ? 'w-56' : 'w-[68px]'
      )}
    >
      {/* Logo */}
      <div className={clsx(
        'flex items-center gap-3 border-b border-[#F0F0F0] shrink-0',
        expanded ? 'px-5 py-4' : 'justify-center py-4'
      )}>
        <img src="/logo.png" alt="Lemon.meet" className="w-8 h-8 object-contain shrink-0" />
        {expanded && (
          <span className="font-semibold text-[15px] text-[#1a1a1a] tracking-tight truncate">Lemon.meet</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {groups.map((group, gi) => (
          <div key={gi} className={clsx(gi > 0 && 'mt-2')}>
            {/* Section label — só quando expandido */}
            {expanded && group.section && (
              <p className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-[#999]">
                {group.section}
              </p>
            )}
            {/* Divider no collapsed */}
            {!expanded && group.section && gi > 0 && (
              <div className="mx-auto w-8 border-t border-[#F0F0F0] my-2" />
            )}

            {group.items.map((item) => {
              const Icon = item.icon
              const active = isActive(item.path)

              return (
                <button
                  key={item.id}
                  onClick={() => navigate(item.path)}
                  title={expanded ? undefined : item.label}
                  className={clsx(
                    'group relative w-full flex items-center gap-3 transition-all duration-150',
                    expanded ? 'px-4 py-2.5' : 'justify-center py-2.5',
                    active
                      ? 'text-[#2D5A27] bg-[#2D5A27]/[0.06]'
                      : item.id === 'coaching'
                        ? 'text-[#7A5C00] bg-[#FFD700]/20 hover:bg-[#FFD700]/35'
                        : 'text-[#555] hover:text-[#2D5A27] hover:bg-[#2D5A27]/[0.04]'
                  )}
                >
                  {/* Borda esquerda ativa — estilo Stripe */}
                  {active && expanded && (
                    <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-[#2D5A27]" />
                  )}

                  <Icon
                    size={18}
                    className={clsx(
                      'shrink-0 transition-colors',
                      active ? 'text-[#2D5A27]' : item.id === 'coaching' ? 'text-[#7A5C00]' : 'text-[#888] group-hover:text-[#2D5A27]'
                    )}
                  />

                  {expanded && (
                    <span className={clsx(
                      'text-[13.5px] leading-5 font-medium truncate',
                      active ? 'text-[#2D5A27]' : item.id === 'coaching' ? 'text-[#7A5C00] font-semibold' : 'text-[#444]'
                    )}>
                      {item.label}
                    </span>
                  )}

                  {/* Dot ativo no collapsed */}
                  {!expanded && active && (
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2D5A27]" />
                  )}

                  {/* Tooltip no collapsed */}
                  {!expanded && (
                    <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                      {item.label}
                      <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="shrink-0 border-t border-[#F0F0F0] py-2">
        {/* Logout */}
        <button
          onClick={handleLogout}
          title={expanded ? undefined : t('nav.logout', 'Sair')}
          className={clsx(
            'group relative w-full flex items-center gap-3 py-2.5 transition-all duration-150',
            'text-[#888] hover:text-[#DC3545] hover:bg-[#DC3545]/[0.05]',
            expanded ? 'px-4' : 'justify-center'
          )}
        >
          <LogOut size={18} className="shrink-0" />
          {expanded && <span className="text-[13.5px] font-medium">{t('nav.logout', 'Sair')}</span>}
          {!expanded && (
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
              {t('nav.logout', 'Sair')}
              <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
            </div>
          )}
        </button>

        {/* Toggle expandir/recolher */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={clsx(
            'w-full flex items-center gap-3 py-2 transition-all duration-150',
            'text-[#aaa] hover:text-[#555]',
            expanded ? 'px-4' : 'justify-center'
          )}
          title={expanded ? 'Recolher' : 'Expandir'}
        >
          {expanded
            ? <><ChevronLeft size={16} /><span className="text-[12px] font-medium">Recolher</span></>
            : <ChevronRight size={16} />
          }
        </button>
      </div>
    </aside>
  )
}
