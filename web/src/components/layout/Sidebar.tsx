import { Home, Video, TrendingUp, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts'
import { clsx } from 'clsx'

export function Sidebar() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const menuItems = [
    { id: 'dashboard', path: '/dashboard', icon: Home, label: t('nav.dashboard') },
    { id: 'meetings', path: '/meetings', icon: Video, label: t('nav.meetings') },
    { id: 'insights', path: '/insights', icon: TrendingUp, label: t('nav.insights') },
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
    <aside className="w-20 h-screen bg-white dark:bg-gray-900 border-r border-neutral-light dark:border-gray-700 flex flex-col items-center py-6 sticky top-0">
      {/* Logo */}
      <div className="mb-8">
        <img src="/logo.png" alt="Lemon.meet" className="w-10 h-10 object-contain" />
      </div>

      {/* Menu Items */}
      <nav className="flex-1 flex flex-col gap-4 w-full items-center">
        {menuItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.path)

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={clsx(
                'w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-200',
                'relative group',
                active
                  ? 'bg-primary text-white shadow-md'
                  : 'text-neutral-mid dark:text-gray-400 hover:text-primary hover:bg-primary/5'
              )}
              title={item.label}
            >
              <Icon size={20} />
              
              {/* Tooltip */}
              <div className="absolute left-full ml-4 px-3 py-1.5 bg-white dark:bg-gray-800 border border-neutral-light dark:border-gray-700 rounded-lg text-body-small text-primary dark:text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-sm">
                {item.label}
              </div>
            </button>
          )
        })}
      </nav>

      {/* Logout Button */}
      <button
        onClick={handleLogout}
        className="w-12 h-12 rounded-xl flex items-center justify-center text-neutral-mid dark:text-gray-400 hover:text-danger hover:bg-danger/5 transition-all duration-200 relative group"
        title={t('nav.logout')}
      >
        <LogOut size={20} />
        
        {/* Tooltip */}
        <div className="absolute left-full ml-4 px-3 py-1.5 bg-white dark:bg-gray-800 border border-neutral-light dark:border-gray-700 rounded-lg text-body-small text-primary dark:text-gray-200 whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 shadow-sm">
          {t('nav.logout')}
        </div>
      </button>
    </aside>
  )
}
