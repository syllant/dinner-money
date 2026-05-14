import { useRef, useState, type ReactNode } from 'react'

export function InfoTooltip({ text, position = 'center', interactive = false, trigger }: {
  text: ReactNode
  position?: 'center' | 'left'
  interactive?: boolean
  trigger?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const width = 256
  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const preferredLeft = position === 'left' ? rect.right - width : rect.left + rect.width / 2 - width / 2
    const left = Math.min(Math.max(204, preferredLeft), window.innerWidth - width - 8)
    const above = rect.top > 220
    const top = above ? rect.top - 10 : rect.bottom + 10
    setCoords({ left, top })
  }
  return (
    <span className={trigger ? 'inline-flex items-center' : 'relative top-[-3px] inline-flex ml-1 align-middle'}>
      <span
        ref={triggerRef}
        className={trigger ? 'cursor-help' : 'inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] text-gray-400 border border-gray-300 dark:border-gray-600 rounded-full leading-none select-none cursor-help'}
        onMouseEnter={() => {
          updatePosition()
          setOpen(true)
        }}
        onMouseLeave={() => {
          if (!interactive) setOpen(false)
        }}
      >
        {trigger ?? '?'}
      </span>
      <span
        className={`fixed w-64 bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-[1.4] px-2.5 py-2 rounded-lg shadow-xl ${open ? 'opacity-100' : 'opacity-0'} ${interactive && open ? 'pointer-events-auto' : 'pointer-events-none'} z-50 whitespace-normal text-left font-normal normal-case transition-opacity duration-100`}
        style={{
          left: coords.left,
          top: coords.top,
          transform: triggerRef.current && triggerRef.current.getBoundingClientRect().top > 220 ? 'translateY(-100%)' : undefined,
        }}
        onMouseEnter={() => {
          if (interactive) setOpen(true)
        }}
        onMouseLeave={() => setOpen(false)}
      >
        {text}
      </span>
    </span>
  )
}
