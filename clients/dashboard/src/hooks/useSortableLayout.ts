import { useState, useCallback, useEffect } from 'react'

/**
 * Persistent sortable layout state.
 * Stores order of items in localStorage. If new items are added later
 * (e.g., after a release), they're appended to the end so the user
 * doesn't lose them.
 */
export function useSortableLayout(storageKey: string, defaultIds: string[]) {
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return defaultIds
      const parsed = JSON.parse(raw) as string[]
      // Keep only valid known ids, in stored order
      const known = parsed.filter((id) => defaultIds.includes(id))
      // Append any new ids that weren't in storage yet
      const missing = defaultIds.filter((id) => !known.includes(id))
      return [...known, ...missing]
    } catch {
      return defaultIds
    }
  })

  // Sync to localStorage whenever order changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order))
    } catch {
      /* quota or disabled storage — ignore */
    }
  }, [storageKey, order])

  const reset = useCallback(() => {
    setOrder(defaultIds)
  }, [defaultIds])

  return { order, setOrder, reset }
}
