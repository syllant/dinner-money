import { useRef, useState } from 'react'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: number | undefined | null
  onChange: (value: number | undefined) => void
  decimals?: number
}

export function NumericInput({ value, onChange, decimals = 0, className, placeholder, ...rest }: NumericInputProps) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const formatted = value != null
    ? value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : ''

  function handleFocus() {
    setRaw(value != null ? String(value) : '')
    setEditing(true)
    setTimeout(() => ref.current?.select(), 0)
  }

  function handleBlur() {
    setEditing(false)
    const n = parseFloat(raw.replace(/[^\d.-]/g, ''))
    onChange(isNaN(n) ? undefined : n)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setRaw(e.target.value)
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={editing ? raw : formatted}
      placeholder={placeholder}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      className={className}
      {...rest}
    />
  )
}
