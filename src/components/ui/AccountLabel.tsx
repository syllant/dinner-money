import type { Account } from '../../types'

type LogoSize = 'xs' | 'sm' | 'md'
type AccountBrand = Pick<Account, 'name' | 'institutionName' | 'institutionLogoUrl' | 'institutionLogoDataUrl' | 'logoSource' | 'ibkrAccountId'>

const SIZE_CLASS: Record<LogoSize, string> = {
  xs: 'h-4 w-4 text-[7px]',
  sm: 'h-5 w-5 text-[8px]',
  md: 'h-7 w-7 text-[10px]',
}


const BUILTIN_BRANDS: Array<{ test: RegExp; label: string; color: string; bg: string }> = [
  { test: /\b(ibkr|interactive\s*brokers?)\b/i, label: 'IBKR', color: '#cc1f26', bg: '#fff5f5' },
]

function builtinBrand(account: Pick<Account, 'name' | 'institutionName' | 'ibkrAccountId'>) {
  const text = `${account.name} ${account.institutionName ?? ''}`
  if (account.ibkrAccountId || BUILTIN_BRANDS[0].test.test(text)) return BUILTIN_BRANDS[0]
  return undefined
}

function initials(account: Pick<Account, 'name' | 'institutionName'>): string {
  const source = (account.institutionName || account.name).replace(/[^a-z0-9 ]/gi, ' ').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return source.slice(0, 3).toUpperCase() || '?'
}

export function AccountLogo({ account, size = 'sm' }: { account: AccountBrand; size?: LogoSize }) {
  const logo = account.institutionLogoDataUrl ?? account.institutionLogoUrl
  const builtin = builtinBrand(account)
  const imageClassName = `${SIZE_CLASS[size]} inline-flex items-center justify-center shrink-0 rounded-[5px] overflow-hidden`
  const fallbackClassName = `${SIZE_CLASS[size]} inline-flex items-center justify-center shrink-0 rounded-[5px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden`

  if (logo) {
    return (
      <span className={imageClassName}>
        <span className="flex h-full w-full items-center justify-center">
          <img src={logo} alt="" className="block max-h-full max-w-full object-contain" />
        </span>
      </span>
    )
  }

  if (builtin) {
    return (
      <span
        className={`${fallbackClassName} font-bold tracking-normal`}
        style={{ color: builtin.color, backgroundColor: builtin.bg }}
      >
        {builtin.label}
      </span>
    )
  }

  return (
    <span className={`${fallbackClassName} font-semibold text-gray-500 dark:text-gray-300 bg-gray-50 dark:bg-gray-800`}>
      {initials(account)}
    </span>
  )
}

export function AccountLabel({ account, size = 'sm', className = '' }: { account: Account; size?: LogoSize; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className}`}>
      <AccountLogo account={account} size={size} />
      <span className="truncate">{account.name}</span>
    </span>
  )
}
