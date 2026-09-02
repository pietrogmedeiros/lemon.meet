import { useTranslation } from 'react-i18next'
import { clsx } from 'clsx'
import { ReactNode } from 'react'

export interface BadgeProps {
  status?: 'recording' | 'processing' | 'completed' | 'failed'
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'info'
  children?: ReactNode
  className?: string
}

export function Badge({ status, variant, children, className }: BadgeProps) {
  const { t } = useTranslation()

  // Se status for fornecido, use a lógica antiga
  if (status) {
    const statusConfig = {
      recording: {
        label: t('meeting.status.recording'),
        color: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/50',
        dot: 'bg-red-500 animate-pulse',
      },
      processing: {
        label: t('meeting.status.processing'),
        color: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-900/50',
        dot: 'bg-orange-500 animate-pulse',
      },
      completed: {
        label: t('meeting.status.completed'),
        color: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-900/50',
        dot: 'bg-green-500',
      },
      failed: {
        label: t('meeting.status.failed'),
        color: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/50',
        dot: 'bg-red-500',
      },
    }

    const config = statusConfig[status]

    return (
      <div
        className={clsx(
          'inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium border',
          config.color,
          className
        )}
      >
        <div className={clsx('w-2 h-2 rounded-full', config.dot)} />
        {config.label}
      </div>
    )
  }

  // Caso contrário, use variant genérico - Design System Vibe AI
  const variantStyles = {
    primary: 'bg-primary/10 dark:bg-primary/20 text-primary border-primary/20',
    secondary: 'bg-neutral-lighter  text-neutral-mid  border-neutral-light ',
    success: 'bg-green-50 dark:bg-green-950/40 dark:bg-green-900/30 text-green-700 dark:text-green-300 dark:text-green-400 border-green-200 dark:border-green-900/50 dark:border-green-700',
    danger: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/50',
    // Azul: informativo, não é defeito. Reunião que não foi gravada porque
    // ninguém admitiu o bot ou o evento foi cancelado não é falha da plataforma.
    info: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/50',
  }

  const baseStyle = variant ? variantStyles[variant] : variantStyles.secondary

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-body-small font-medium border',
        baseStyle,
        className
      )}
    >
      {children}
    </span>
  )
}
