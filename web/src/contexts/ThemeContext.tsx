import { createContext, useContext, ReactNode, useEffect } from 'react'

type Theme = 'light'

interface ThemeContextType {
  theme: Theme
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Garante que dark mode nunca seja aplicado
    document.documentElement.classList.remove('dark')
    localStorage.removeItem('vibe-ai-theme')
  }, [])

  return (
    <ThemeContext.Provider value={{ theme: 'light' }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
