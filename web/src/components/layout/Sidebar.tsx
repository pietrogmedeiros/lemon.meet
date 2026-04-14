import { useState } from 'react'
import { Home, Video, TrendingUp, LogOut, Settings, ChevronLeft, ChevronRight, Users, CreditCard, Plug, GraduationCap, FileText, Lock, HelpCircle, CalendarClock, Shield, Webhook, ChevronDown, Calendar } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, useSubscription } from '@/contexts'
import { clsx } from 'clsx'
import { OnboardingModal, useOnboarding } from '@/components/ui/OnboardingModal'

interface MenuItem {
  id: string
  path: string
  icon: React.ElementType
  label: string
  children?: { id: string; path: string; icon: React.ElementType; label: string }[]
}

interface MenuGroup {
  section?: string
  items: MenuItem[]
}

export function Sidebar() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const { subscription } = useSubscription()
  const navigate = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ integrations: true })
  const { open: onboardingOpen, openModal: openOnboarding, closeModal: closeOnboarding } = useOnboarding()

  const toggleGroup = (id: string) => setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))

  const isPro = subscription?.plan === 'professional' || subscription?.plan === 'trial'

  const groups: MenuGroup[] = [
    {
      items: [
        { id: 'dashboard',    path: '/dashboard',    icon: Home,           label: t('nav.dashboard') },
        { id: 'upcoming',     path: '/upcoming',     icon: CalendarClock,  label: 'Próximas' },
        { id: 'meetings',     path: '/meetings',     icon: Video,          label: t('nav.meetings') },
        { id: 'insights',     path: '/insights',     icon: TrendingUp,     label: t('nav.insights') },
        { id: 'coaching',     path: '/coaching',     icon: GraduationCap,  label: 'Coaching' },
        { id: 'relatorio',    path: '/relatorio',    icon: FileText,       label: 'Relatório Semanal' },
        { id: 'calendar',     path: '/calendar',     icon: Calendar,       label: 'Calendário' },
      ],
    },
    {
      section: 'Conta',
      items: [
        { id: 'team',         path: '/team',                    icon: Users,      label: t('nav.team', 'Meu Time') },
        {
          id: 'integrations',
          path: '/integrations/permissions',
          icon: Plug,
          label: 'Integrações',
          children: [
            { id: 'integrations-permissions', path: '/integrations/permissions', icon: Shield,  label: 'Permissões' },
            { id: 'integrations-webhooks',    path: '/integrations/webhooks',    icon: Webhook, label: 'Webhook' },
          ],
        },
        { id: 'subscription', path: '/subscription',             icon: CreditCard, label: 'Minha Assinatura' },
        { id: 'settings',     path: '/settings',                 icon: Settings,   label: t('nav.settings', 'Configurações') },
      ],
    },
  ]

  const isActive = (path: string) => {
    if (path === '/meetings') return location.pathname.startsWith('/meetings')
    if (path === '/integrations/permissions') return location.pathname.startsWith('/integrations')
    return location.pathname === path
  }

  const handleLogout = async () => {
    if (window.confirm(t('auth.logout.confirm'))) {
      await signOut()
    }
  }

  return (
    <>
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

              const isLocked = item.id === 'coaching' && !isPro
              const hasChildren = !!item.children?.length
              const childrenOpen = hasChildren && (openGroups[item.id] ?? true)
              const handleItemClick = () => {
                if (isLocked) return
                if (hasChildren && expanded) { toggleGroup(item.id); return }
                navigate(item.path)
              }

              return (
                <>
                <button
                  key={item.id}
                  onClick={handleItemClick}
                  title={expanded ? undefined : isLocked ? 'Disponível no plano Professional' : item.label}
                  className={clsx(
                    'group relative w-full flex items-center gap-3 transition-all duration-150',
                    expanded ? 'px-4 py-2.5' : 'justify-center py-2.5',
                    isLocked
                      ? 'opacity-60 cursor-not-allowed text-[#888]'
                      : active
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
                      isLocked ? 'text-[#aaa]' : active ? 'text-[#2D5A27]' : item.id === 'coaching' ? 'text-[#7A5C00]' : 'text-[#888] group-hover:text-[#2D5A27]'
                    )}
                  />

                  {expanded && (
                    <span className={clsx(
                      'text-[13.5px] leading-5 font-medium truncate flex-1',
                      isLocked ? 'text-[#aaa]' : active ? 'text-[#2D5A27]' : item.id === 'coaching' ? 'text-[#7A5C00] font-semibold' : 'text-[#444]'
                    )}>
                      {item.label}
                    </span>
                  )}

                  {/* Chevron para itens com filhos */}
                  {expanded && hasChildren && (
                    <ChevronDown
                      size={14}
                      className={clsx(
                        'shrink-0 transition-transform duration-200 text-[#aaa]',
                        childrenOpen && 'rotate-180'
                      )}
                    />
                  )}

                  {/* Cadeado para itens bloqueados */}
                  {isLocked && (
                    <Lock size={12} className="shrink-0 text-[#aaa]" />
                  )}

                  {/* Dot ativo no collapsed */}
                  {!expanded && active && (
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2D5A27]" />
                  )}

                  {/* Tooltip no collapsed */}
                  {!expanded && (
                    <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                      {isLocked ? 'Disponível no plano Professional' : item.label}
                      <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
                    </div>
                  )}

                  {/* Tooltip no expanded */ }
                  {expanded && isLocked && (
                    <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 shadow-lg">
                      Disponível no plano Professional
                      <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
                    </div>
                  )}
                </button>

                {/* Sub-itens — visíveis apenas quando expandido e grupo aberto */}
                {expanded && childrenOpen && item.children && item.children.map(child => {
                  const childActive = location.pathname === child.path
                  const ChildIcon = child.icon
                  return (
                    <button
                      key={child.id}
                      onClick={() => navigate(child.path)}
                      className={clsx(
                        'w-full flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] font-medium transition-all duration-150 rounded-sm',
                        childActive
                          ? 'text-[#2D5A27] bg-[#2D5A27]/[0.06]'
                          : 'text-[#777] hover:text-[#2D5A27] hover:bg-[#2D5A27]/[0.04]'
                      )}
                    >
                      <ChildIcon size={13} className="shrink-0" />
                      {child.label}
                    </button>
                  )
                })}
                </>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="shrink-0 border-t border-[#F0F0F0] py-2">
        {/* Como Usar */}
        <button
          onClick={openOnboarding}
          title={expanded ? undefined : 'Como Usar'}
          className={clsx(
            'group relative w-full flex items-center gap-3 py-2.5 transition-all duration-150',
            'text-[#888] hover:text-[#2D5A27] hover:bg-[#2D5A27]/[0.04]',
            expanded ? 'px-4' : 'justify-center'
          )}
        >
          <HelpCircle size={18} className="shrink-0" />
          {expanded && <span className="text-[13.5px] font-medium">Como Usar</span>}
          {!expanded && (
            <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
              Como Usar
              <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
            </div>
          )}
        </button>

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

    <OnboardingModal open={onboardingOpen} onClose={closeOnboarding} />
    </>
  )
}
