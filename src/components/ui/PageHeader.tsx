export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="h-[44px] flex items-center justify-between px-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-950 z-10">
      <h1 className="text-[14px] font-medium">{title}</h1>
      {children && <div className="flex items-center gap-[7px]">{children}</div>}
    </div>
  )
}
