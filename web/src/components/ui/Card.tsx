import { ReactNode } from 'react'
import { clsx } from 'clsx'

export interface CardProps {
  children: ReactNode
  variant?: 'default' | 'primary' | 'bordered'
  className?: string
  onClick?: () => void
}

export function Card({ children, variant = 'default', className, onClick }: CardProps) {
  const variantStyles = {
    default: 'bg-surface dark:bg-gray-800 border border-neutral-light dark:border-gray-700 shadow-sm',
    primary: 'bg-surface dark:bg-gray-800 border border-primary/30 hover:border-primary/50 shadow-sm',
    bordered: 'bg-surface dark:bg-gray-800 border-2 border-neutral-light dark:border-gray-700',
  }

  return (
    <div
      className={clsx(
        'p-6 rounded-lg transition-all duration-200',
        variantStyles[variant],
        onClick && 'cursor-pointer hover:shadow-md hover:scale-[1.01]',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}
