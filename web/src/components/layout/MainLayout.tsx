import { ReactNode } from 'react'
import { Sidebar, TopNavBar } from '@/components/layout'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  return (
    <div className="flex min-h-screen bg-background dark:bg-gray-900">
      <Sidebar />
      
      <div className="flex-1 flex flex-col">
        <TopNavBar />
        
        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
