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
    default: 'bg-surface  border border-neutral-light  shadow-sm',
    primary: 'bg-surface  border border-primary/30 hover:border-primary/50 shadow-sm',
    bordered: 'bg-surface  border-2 border-neutral-light ',
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
