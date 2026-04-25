import { clsx } from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'success' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'default', size = 'sm', className, children, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={clsx(
        'rounded-[5px] border font-normal cursor-pointer transition-colors',
        size === 'sm' && 'text-[11.5px] px-[10px] py-[4px]',
        size === 'md' && 'text-[13px] px-[14px] py-[7px]',
        variant === 'default' && 'border-gray-300 dark:border-gray-600 bg-transparent text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800',
        variant === 'success' && 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100',
        variant === 'danger' && 'border-red-300 dark:border-red-700 bg-transparent text-red-600 dark:text-red-400 hover:bg-red-50',
        className
      )}
    >
      {children}
    </button>
  )
}
