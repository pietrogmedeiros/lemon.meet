import { useState, useEffect, useRef } from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { useAuth, useSubscription } from '@/contexts'

const languages = [
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

const PLAN_CONFIG: Record<string, { label: string; cls: string }> = {
  trial:        { label: 'Trial', cls: 'bg-blue-50 text-blue-600 border-blue-200' },
  starter:      { label: 'Starter', cls: 'bg-[#2D5A27]/8 text-[#2D5A27] border-[#2D5A27]/20' },
  professional: { label: 'Professional', cls: 'bg-amber-50 text-amber-600 border-amber-200' },
}

export function TopNavBar() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { subscription, loading: subLoading } = useSubscription()
  const [showLangMenu, setShowLangMenu] = useState(false)
  const langMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setShowLangMenu(false)
      }
    }
    if (showLangMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showLangMenu])

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode)
    localStorage.setItem('vibe-ai-language', langCode)
    setShowLangMenu(false)
  }

  return (
    <header className="h-16 bg-white border-b border-neutral-light px-8 flex items-center justify-between sticky top-0 z-40">
      {/* Left: tagline sutil */}
      <p className="text-[12px] text-[#bbb] font-normal tracking-wide select-none hidden sm:block">
        Esprema o melhor das suas reuniões 🍋
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
        {/* Language Selector */}
        <div className="relative" ref={langMenuRef}>
          <button
            onClick={() => setShowLangMenu(!showLangMenu)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-neutral-mid hover:text-primary hover:bg-primary/5 transition-all duration-200"
            title={t('topbar.language')}
          >
            <Globe size={20} />
          </button>

          {showLangMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-neutral-light rounded-xl p-2 shadow-lg z-50">
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => handleLanguageChange(lang.code)}
                  className={clsx(
                    'w-full px-3 py-2 rounded-lg text-left flex items-center gap-3',
                    'transition-all duration-200',
                    i18n.language === lang.code
                      ? 'bg-primary text-white'
                      : 'text-primary hover:bg-primary/5'
                  )}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span className="text-body-small">{lang.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

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
