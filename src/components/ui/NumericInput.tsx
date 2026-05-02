import { useRef, useState } from 'react'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
  decimals?: number
}

/** Format a raw digit string with thousands commas (and optional decimal places). */
function applyCommas(str: string, decimals: number): string {
  const clean = decimals > 0
    ? str.replace(/[^\d.]/g, '')
    : str.replace(/\D/g, '')
  if (decimals > 0) {
    const [intPart = '', decPart = ''] = clean.split('.')
    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return clean.includes('.') ? `${formattedInt}.${decPart.slice(0, decimals)}` : formattedInt
  }
  return clean.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function NumericInput({ value, onChange, decimals = 0, className, placeholder, ...rest }: NumericInputProps) {
  // null = not focused (display formatted value from prop)
  const [editStr, setEditStr] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)

  const displayValue = editStr !== null
    ? editStr
    : value != null ? applyCommas(String(Math.round(value)), decimals) : ''

  function handleFocus() {
    const initial = value != null ? applyCommas(String(value), decimals) : ''
    setEditStr(initial)
    setTimeout(() => ref.current?.select(), 0)
  }

  function handleBlur() {
    const raw = (editStr ?? '').replace(/,/g, '')
    const n = decimals > 0 ? parseFloat(raw) : parseInt(raw, 10)
    onChange(isNaN(n) ? undefined : n)
    setEditStr(null)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const inputVal = e.target.value
    const cursorPos = e.target.selectionStart ?? inputVal.length

    // Count how many digit characters appear before the cursor
    const digitsBeforeCursor = inputVal.slice(0, cursorPos).replace(/\D/g, '').length

    const formatted = applyCommas(inputVal, decimals)
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
      inputMode="numeric"
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
