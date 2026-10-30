import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-1 hidden h-5 min-w-5 items-center justify-center rounded border border-current/20 px-1 font-sans text-[10px] opacity-60 sm:inline-flex">
      {children}
    </kbd>
  )
}
