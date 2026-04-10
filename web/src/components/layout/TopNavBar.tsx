import { useState, useEffect, useRef } from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { useAuth } from '@/contexts'

const languages = [
  { code: 'pt-BR', label: 'Português', flag: '🇧🇷' },
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
]

export function TopNavBar() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
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
      {/* Left: Google Partner */}
      <div className="flex items-center gap-2">
        <img
          src="https://e7.pngegg.com/pngimages/704/688/png-clipart-google-google.png"
          alt="Google"
          className="h-6 w-6 object-contain rounded-sm"
        />
        <span className="text-body-small font-medium text-secondary">Google Partner</span>
      </div>

      {/* Right: Language, Profile */}
      <div className="flex items-center gap-3">
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
