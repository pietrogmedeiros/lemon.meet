import { ReactNode, ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'text' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className,
  ...props
}: ButtonProps) {
  const variantStyles = {
    primary: 'bg-accent hover:bg-accent-light text-primary font-bold disabled:opacity-50',
    secondary: 'bg-surface hover:bg-neutral-lighter text-primary border border-primary hover:border-primary-light disabled:opacity-50',
    text: 'bg-transparent hover:bg-neutral-lighter text-primary hover:text-primary-light disabled:opacity-50',
    danger: 'bg-danger hover:bg-danger-light text-white disabled:opacity-50',
    ghost: 'bg-transparent hover:bg-neutral-lighter text-secondary hover:text-primary disabled:opacity-50',
  }

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-button',
    lg: 'px-6 py-3 text-lg font-semibold',
  }

  return (
    <button
      className={clsx(
        'rounded-md font-semibold transition-all duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'flex items-center gap-2 justify-center',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      ) : (
        icon && <span className="flex-shrink-0">{icon}</span>
      )}
      {children}
    </button>
  )
}
