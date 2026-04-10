import { format, parseISO } from 'date-fns'
import { ptBR, enUS, es } from 'date-fns/locale'

const locales = {
  'pt-BR': ptBR,
  'en-US': enUS,
  'es': es,
}

export type SupportedLocale = keyof typeof locales

/**
 * Formata uma data no padrão DD-MM-AAAA (Brasil) ou localizado conforme idioma
 * @param date - Data em formato ISO string, Date object ou timestamp
 * @param locale - Locale para formatação (padrão: pt-BR)
 * @returns Data formatada
 */
export function formatDate(
  date: string | Date | number,
  locale: SupportedLocale = 'pt-BR'
): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    
    // Formato brasileiro é sempre DD-MM-AAAA
    if (locale === 'pt-BR' || locale === 'es') {
      return format(dateObj, 'dd-MM-yyyy', { locale: locales[locale] })
    }
    
    // Formato americano é MM-DD-YYYY
    return format(dateObj, 'MM-dd-yyyy', { locale: locales[locale] })
  } catch (error) {
    console.error('Error formatting date:', error)
    return 'Invalid date'
  }
}

/**
 * Formata data e hora juntos
 * @param date - Data em formato ISO string, Date object ou timestamp
 * @param locale - Locale para formatação (padrão: pt-BR)
 * @returns Data e hora formatadas
 */
export function formatDateTime(
  date: string | Date | number,
  locale: SupportedLocale = 'pt-BR'
): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    
    if (locale === 'pt-BR' || locale === 'es') {
      return format(dateObj, "dd-MM-yyyy 'às' HH:mm", { locale: locales[locale] })
    }
    
    return format(dateObj, 'MM-dd-yyyy at hh:mm a', { locale: locales[locale] })
  } catch (error) {
    console.error('Error formatting datetime:', error)
    return 'Invalid date'
  }
}

/**
 * Formata apenas a hora
 * @param date - Data em formato ISO string, Date object ou timestamp
 * @param locale - Locale para formatação (padrão: pt-BR)
 * @returns Hora formatada
 */
export function formatTime(
  date: string | Date | number,
  locale: SupportedLocale = 'pt-BR'
): string {
  try {
    const dateObj = typeof date === 'string' ? parseISO(date) : new Date(date)
    
    if (locale === 'pt-BR' || locale === 'es') {
      return format(dateObj, 'HH:mm', { locale: locales[locale] })
    }
    
    return format(dateObj, 'hh:mm a', { locale: locales[locale] })
  } catch (error) {
    console.error('Error formatting time:', error)
    return 'Invalid time'
  }
}

/**
 * Retorna a data atual no formato padrão
 * @param locale - Locale para formatação (padrão: pt-BR)
 * @returns Data atual formatada
 */
export function getCurrentDate(locale: SupportedLocale = 'pt-BR'): string {
  return formatDate(new Date(), locale)
}
