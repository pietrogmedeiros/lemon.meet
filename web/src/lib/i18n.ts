import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ptBR from '@/locales/pt-BR.json'
import enUS from '@/locales/en-US.json'
import es from '@/locales/es.json'

const STORAGE_KEY = 'vibe-ai-language'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'pt-BR': { translation: ptBR },
      'en-US': { translation: enUS },
      'es': { translation: es },
    },
    lng: localStorage.getItem(STORAGE_KEY) || 'pt-BR',
    fallbackLng: 'pt-BR',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n
