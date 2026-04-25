import { Sidebar } from './Sidebar'

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-white">
      <Sidebar />
      <div className="flex-1 overflow-y-auto min-w-0">
        {children}
      </div>
    </div>
  )
}
