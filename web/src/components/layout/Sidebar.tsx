import { useState } from 'react'
import { Home, Video, TrendingUp, LogOut, Settings, ChevronRight, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts'
import { clsx } from 'clsx'

export function Sidebar() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [expanded, setExpanded] = useState(false)

  const menuItems = [
    { id: 'dashboard', path: '/dashboard', icon: Home, label: t('nav.dashboard') },
    { id: 'meetings', path: '/meetings', icon: Video, label: t('nav.meetings') },
    { id: 'insights', path: '/insights', icon: TrendingUp, label: t('nav.insights') },
    { id: 'team', path: '/team', icon: Users, label: t('nav.team', 'Meu Time') },
    { id: 'settings', path: '/settings', icon: Settings, label: t('nav.settings', 'Configurações') },
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
        'h-screen bg-white dark:bg-gray-900 border-r border-neutral-light dark:border-gray-700',
        'flex flex-col py-6 sticky top-0 transition-all duration-300 overflow-hidden',
        expanded ? 'w-52' : 'w-20'
      )}
    >
      {/* Logo + toggle */}
      <div className={clsx('flex items-center mb-8', expanded ? 'px-4 gap-3' : 'justify-center')}>
        <img src="/logo.png" alt="Lemon.meet" className="w-10 h-10 object-contain shrink-0" />
        {expanded && (
          <span className="text-sm font-semibold text-primary truncate">Lemon.meet</span>
        )}
      </div>

      {/* Menu Items */}
      <nav className="flex-1 flex flex-col gap-1 w-full px-3">
        {menuItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={clsx(
                'flex items-center gap-3 rounded-xl transition-all duration-200 h-12',
                expanded ? 'px-3 w-full' : 'w-12 justify-center mx-auto relative group',
                active
                  ? 'bg-primary text-white shadow-md'
                  : 'text-neutral-mid dark:text-gray-400 hover:text-primary hover:bg-primary/5'
              )}
              title={expanded ? undefined : item.label}
            >
              <Icon size={20} className="shrink-0" />
              {expanded && (
                <span className="text-sm font-medium truncate">{item.label}</span>
              )}

              {/* Tooltip só quando recolhido */}
              {!expanded && (
                <div className="absolute left-full ml-4 px-3 py-1.5 bg-white dark:bg-gray-800 border border-neutral-light dark:border-gray-700 rounded-lg text-body-small text-primary dark:text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-sm">
                  {item.label}
                </div>
              )}
            </button>
          )
        })}
      </nav>

      {/* Bottom: logout + toggle */}
      <div className="flex flex-col gap-1 px-3">
        <button
          onClick={handleLogout}
          className={clsx(
            'flex items-center gap-3 rounded-xl h-12 transition-all duration-200',
            'text-neutral-mid dark:text-gray-400 hover:text-danger hover:bg-danger/5',
            expanded ? 'px-3 w-full' : 'w-12 justify-center mx-auto relative group'
          )}
          title={expanded ? undefined : t('nav.logout')}
        >
          <LogOut size={20} className="shrink-0" />
          {expanded && <span className="text-sm font-medium">{t('nav.logout')}</span>}
          {!expanded && (
            <div className="absolute left-full ml-4 px-3 py-1.5 bg-white dark:bg-gray-800 border border-neutral-light dark:border-gray-700 rounded-lg text-body-small text-primary dark:text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-sm">
              {t('nav.logout')}
            </div>
          )}
        </button>

        {/* Botão de expandir/recolher */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={clsx(
            'flex items-center gap-3 rounded-xl h-10 transition-all duration-200',
            'text-neutral-mid hover:text-primary hover:bg-primary/5',
            expanded ? 'px-3 w-full' : 'w-12 justify-center mx-auto'
          )}
          title={expanded ? 'Recolher menu' : 'Expandir menu'}
        >
          <ChevronRight
            size={18}
            className={clsx('transition-transform duration-300 shrink-0', expanded && 'rotate-180')}
          />
          {expanded && <span className="text-xs text-neutral-mid">Recolher</span>}
        </button>
      </div>
    </aside>
  )
}
