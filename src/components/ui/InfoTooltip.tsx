export function InfoTooltip({ text, position = 'center' }: { text: string; position?: 'center' | 'left' }) {
  const posClass = position === 'left'
    ? 'right-0'
    : 'left-1/2 -translate-x-1/2'
  return (
    <span className="relative inline-block group ml-1 align-middle cursor-help">
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] text-gray-400 border border-gray-300 dark:border-gray-600 rounded-full leading-none select-none">?</span>
      <span className={`absolute bottom-full ${posClass} mb-1.5 w-52 bg-gray-900 dark:bg-gray-700 text-white text-[10px] leading-[1.4] px-2.5 py-2 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none z-[60] whitespace-normal text-left font-normal normal-case transition-opacity duration-100`}>
        {text}
      </span>
    </span>
  )
}
