import { useRef, useState } from 'react'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
  decimals?: number
}

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
const groupSep = parts.find(part => part.type === 'group')?.value ?? ','
const decimalSep = parts.find(part => part.type === 'decimal')?.value ?? '.'

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeInput(str: string, decimals: number): string {
  let clean = str
    .replace(new RegExp(escapeRegExp(groupSep), 'g'), '')
    .replace(/\s/g, '')
  if (decimalSep !== '.') clean = clean.replace(new RegExp(escapeRegExp(decimalSep), 'g'), '.')

  clean = decimals > 0
    ? clean.replace(/[^\d.]/g, '')
    : clean.replace(/\D/g, '')

  if (decimals <= 0) return clean
  const firstDecimal = clean.indexOf('.')
  if (firstDecimal < 0) return clean
  const intPart = clean.slice(0, firstDecimal)
  const decPart = clean.slice(firstDecimal + 1).replace(/\./g, '')
  return `${intPart}.${decPart}`
}

/** Format a raw digit string with locale grouping and optional decimal places. */
function applySeparators(str: string, decimals: number): string {
  const clean = normalizeInput(str, decimals)
  if (decimals > 0) {
    const [intPart = '', decPart = ''] = clean.split('.')
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep)
    return clean.includes('.') ? `${formattedInt}${decimalSep}${decPart.slice(0, decimals)}` : formattedInt
  }
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep)
}

export function NumericInput({ value, onChange, decimals = 0, className, placeholder, ...rest }: NumericInputProps) {
  // null = not focused (display formatted value from prop)
  const [editStr, setEditStr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const displayValue = editStr !== null
    ? editStr
    : value != null ? applySeparators(decimals > 0 ? String(value) : String(Math.round(value)), decimals) : ''

  function handleFocus() {
    const initial = value != null ? applySeparators(String(value), decimals) : ''
    setEditStr(initial)
    setTimeout(() => ref.current?.select(), 0)
  }

  function handleBlur() {
    const raw = normalizeInput(editStr ?? '', decimals)
    const n = decimals > 0 ? parseFloat(raw) : parseInt(raw, 10)
    onChange(isNaN(n) ? undefined : n)
    setEditStr(null)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const inputVal = e.target.value
    const cursorPos = e.target.selectionStart ?? inputVal.length

    // Count how many digit characters appear before the cursor
    const digitsBeforeCursor = inputVal.slice(0, cursorPos).replace(/\D/g, '').length

    const formatted = applySeparators(inputVal, decimals)
    setEditStr(formatted)

    // Restore cursor: find position in formatted string where that many digits have passed
    requestAnimationFrame(() => {
      if (!ref.current) return
      let digitCount = 0
      let newPos = formatted.length
      for (let i = 0; i < formatted.length; i++) {
        if (/\d/.test(formatted[i])) digitCount++
        if (digitCount === digitsBeforeCursor) { newPos = i + 1; break }
      }
      ref.current.setSelectionRange(newPos, newPos)
    })
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      value={displayValue}
      placeholder={placeholder}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  )
}
