import { useState, useEffect, useCallback, Fragment } from 'react'
import { Home, Video, TrendingUp, Settings, ChevronLeft, ChevronRight, Users, CreditCard, Plug, GraduationCap, FileText, Lock, HelpCircle, CalendarClock, Shield, Webhook, ChevronDown, Calendar, Repeat, Radio } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth, useSubscription } from '@/contexts'
import { clsx } from 'clsx'
import { OnboardingModal, useOnboarding } from '@/components/ui/OnboardingModal'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { ThemeAnnounceCoachmark } from '@/components/ThemeAnnounceCoachmark'

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
  const { signOut, session } = useAuth()
  const { subscription } = useSubscription()
  const navigate = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState(true)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ integrations: true })
  const { open: onboardingOpen, openModal: openOnboarding, closeModal: closeOnboarding } = useOnboarding()

  // Anúncio one-time do tema dark (coachmark apontando pro toggle). Reaparece a
  // cada reload ATÉ o usuário fechar; depois nunca mais.
  const themeAnnounceKey = session?.user?.id ? `lemon_announce_dark_theme_${session.user.id}` : null
  const [showThemeAnnounce, setShowThemeAnnounce] = useState(false)
  useEffect(() => {
    if (themeAnnounceKey && !localStorage.getItem(themeAnnounceKey)) setShowThemeAnnounce(true)
  }, [themeAnnounceKey])
  const dismissThemeAnnounce = () => {
    if (themeAnnounceKey) localStorage.setItem(themeAnnounceKey, '1')
    setShowThemeAnnounce(false)
  }

  const getCachedOwnership = () => {
    try { return localStorage.getItem('isTeamOwner') === 'true' } catch { return false }
  }
  const [isTeamOwner, setIsTeamOwner] = useState(getCachedOwnership())

  const WEBINAR_ALLOWLIST = new Set([
    'pietrogoncalvesmedeiros@gmail.com',
    'deive.oliveira@starbem.app',
  ])
  const userEmail = session?.user?.email?.toLowerCase().trim() ?? ''
  const isWebinarAdmin = WEBINAR_ALLOWLIST.has(userEmail)

  const userMeta = session?.user?.user_metadata as Record<string, any> | undefined
  const userName: string =
    (userMeta?.full_name as string) ||
    (userMeta?.name as string) ||
    (session?.user?.email?.split('@')[0] ?? 'Usuário')
  const userAvatar: string | null = (userMeta?.avatar_url as string) || null
  const userInitial = (userName?.charAt(0) || 'U').toUpperCase()

  const toggleGroup = (id: string) => setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))

  const isPro = subscription?.plan === 'professional' || subscription?.plan === 'trial'

  const checkTeamOwnership = useCallback(async () => {
    if (!session) return
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000'
      const response = await fetch(`${apiUrl}/api/teams`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (response.ok) {
        const data = await response.json()
        const hasOwnerTeam = data.teams?.some((team: any) => team.isOwner) ?? false
        setIsTeamOwner(hasOwnerTeam)
        try { localStorage.setItem('isTeamOwner', String(hasOwnerTeam)) } catch {}
      }
    } catch (error) {
      console.error('[Sidebar] Erro ao verificar ownership:', error)
    }
  }, [session])

  useEffect(() => {
    checkTeamOwnership()
  }, [checkTeamOwnership])

  const groups: MenuGroup[] = [
    {
      section: 'Principais',
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
        ...(isTeamOwner ? [{ id: 'router',  path: '/team-scheduling', icon: Repeat, label: 'Round Robin' }] : []),
        ...(isWebinarAdmin ? [{ id: 'webinar', path: '/webinars',     icon: Radio,  label: 'Webinar' }] : []),
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
          'h-screen bg-surface border-r border-neutral-light flex flex-col sticky top-0 transition-all duration-300 overflow-hidden',
          expanded ? 'w-60' : 'w-[72px]'
        )}
      >
        {/* Header */}
        <div className={clsx(
          'flex items-center gap-3 shrink-0',
          expanded ? 'px-5 pt-5 pb-4' : 'justify-center pt-5 pb-4'
        )}>
          <img src="/logo.png" alt="Lemon.meet" className="w-9 h-9 object-contain shrink-0" />
          {expanded && (
            <>
              <span className="font-bold text-[14px] text-primary tracking-tight truncate">Lemon.meet</span>
              <ThemeToggle className="ml-auto" />
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto pb-3">
          {groups.map((group, gi) => (
            <div key={gi} className={clsx(gi > 0 && 'mt-5')}>
              {expanded && group.section && (
                <p className="px-5 pt-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                  {group.section}
                </p>
              )}
              {!expanded && group.section && gi > 0 && (
                <div className="mx-auto w-8 border-t border-neutral-light my-3" />
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
                  <Fragment key={item.id}>
                    <button
                      onClick={handleItemClick}
                      title={expanded ? undefined : isLocked ? 'Disponível no plano Professional' : item.label}
                      className={clsx(
                        'group relative w-full flex items-center transition-all duration-150',
                        expanded ? 'gap-3 px-5 py-2.5' : 'justify-center py-2.5',
                        isLocked
                          ? 'opacity-60 cursor-not-allowed text-tertiary'
                          : active
                            ? 'bg-neutral-lighter text-brand'
                            : 'text-primary hover:bg-background'
                      )}
                    >
                      {/* Borda esquerda quando ativo */}
                      {active && expanded && (
                        <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2D5A27]" />
                      )}

                      <Icon
                        size={16}
                        strokeWidth={1.75}
                        className={clsx(
                          'shrink-0 transition-colors',
                          isLocked ? 'text-tertiary' : active ? 'text-brand' : 'text-secondary group-hover:text-brand'
                        )}
                      />

                      {expanded && (
                        <span className={clsx(
                          'text-[12.5px] leading-5 truncate flex-1 flex items-center gap-1.5 text-left',
                          active ? 'font-semibold text-brand' : 'font-medium text-primary'
                        )}>
                          {item.label}
                          {item.id === 'router' && (
                            <span className="text-[8.5px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#2D5A27]/10 text-brand tracking-wide">
                              Novo
                            </span>
                          )}
                          {item.id === 'webinar' && (
                            <span className="text-[8.5px] font-semibold uppercase px-1.5 py-0.5 rounded bg-[#2D5A27]/10 text-brand tracking-wide">
                              Novo
                            </span>
                          )}
                        </span>
                      )}

                      {expanded && hasChildren && (
                        <ChevronDown
                          size={14}
                          className={clsx(
                            'shrink-0 transition-transform duration-200 text-tertiary',
                            childrenOpen && 'rotate-180'
                          )}
                        />
                      )}

                      {isLocked && expanded && <Lock size={12} className="shrink-0 text-tertiary" />}

                      {!expanded && active && (
                        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-[#2D5A27]" />
                      )}

                      {/* Tooltip collapsed */}
                      {!expanded && (
                        <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                          {isLocked ? 'Disponível no plano Professional' : item.label}
                          <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
                        </div>
                      )}
                    </button>

                    {/* Sub-itens */}
                    {expanded && childrenOpen && item.children?.map(child => {
                      const childActive = location.pathname === child.path
                      const ChildIcon = child.icon
                      return (
                        <button
                          key={child.id}
                          onClick={() => navigate(child.path)}
                          className={clsx(
                            'w-full flex items-center gap-3 pl-12 pr-5 py-1.5 text-[11.5px] transition-colors',
                            childActive
                              ? 'text-brand font-semibold bg-neutral-lighter'
                              : 'text-secondary hover:text-brand hover:bg-background'
                          )}
                        >
                          <ChildIcon size={13} strokeWidth={1.75} className="shrink-0" />
                          {child.label}
                        </button>
                      )
                    })}
                  </Fragment>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-neutral-light">
          {/* Como Usar — discreto */}
          <button
            onClick={openOnboarding}
            title={expanded ? undefined : 'Como Usar'}
            className={clsx(
              'group relative w-full flex items-center transition-colors text-secondary hover:text-brand hover:bg-background',
              expanded ? 'gap-3 px-5 py-2.5' : 'justify-center py-2.5'
            )}
          >
            <HelpCircle size={14} strokeWidth={1.75} className="shrink-0" />
            {expanded && <span className="text-[11.5px] font-medium">Como Usar</span>}
            {!expanded && (
              <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                Como Usar
                <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
              </div>
            )}
          </button>

          {/* User block */}
          <div className={clsx(
            'flex items-center border-t border-neutral-light',
            expanded ? 'gap-3 px-5 py-3' : 'justify-center py-3'
          )}>
            {userAvatar ? (
              <img src={userAvatar} alt={userName} className="w-9 h-9 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[#2D5A27] text-white font-semibold flex items-center justify-center shrink-0 text-sm">
                {userInitial}
              </div>
            )}
            {expanded && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-primary truncate leading-tight">{userName}</p>
                  <p className="text-[10px] text-tertiary truncate leading-tight mt-0.5">Usuário</p>
                </div>
                <button
                  onClick={() => navigate('/settings')}
                  className="p-1.5 rounded-md hover:bg-neutral-lighter text-tertiary hover:text-brand transition-colors"
                  title="Configurações"
                >
                  <Settings size={16} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>

          {/* Sair da Conta */}
          <button
            onClick={handleLogout}
            title={expanded ? undefined : t('nav.logout', 'Sair')}
            className={clsx(
              'group relative w-full flex items-center justify-center border-t border-neutral-light transition-colors hover:bg-[#FEF2F2]',
              expanded ? 'py-3' : 'py-3'
            )}
          >
            {expanded ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary group-hover:text-[#DC3545]">
                Sair da Conta
              </span>
            ) : (
              <>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary group-hover:text-[#DC3545]">Sair</span>
                <div className="absolute left-full ml-3 px-2.5 py-1.5 bg-[#1a1a1a] text-white text-xs font-medium rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg">
                  {t('nav.logout', 'Sair')}
                  <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#1a1a1a]" />
                </div>
              </>
            )}
          </button>

          {/* Toggle expandir/recolher */}
          <button
            onClick={() => setExpanded(!expanded)}
            className={clsx(
              'w-full flex items-center justify-center gap-2 py-2 border-t border-neutral-light text-tertiary hover:text-secondary transition-colors',
            )}
            title={expanded ? 'Recolher' : 'Expandir'}
          >
            {expanded
              ? <><ChevronLeft size={12} /><span className="text-[10px] font-medium">Recolher</span></>
              : <ChevronRight size={12} />
            }
          </button>
        </div>
      </aside>

      <OnboardingModal open={onboardingOpen} onClose={closeOnboarding} />

      {showThemeAnnounce && expanded && (
        <ThemeAnnounceCoachmark onClose={dismissThemeAnnounce} />
      )}
    </>
  )
}
