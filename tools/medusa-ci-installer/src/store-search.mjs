// Pinned Medusa DTC Starter storefront search component. The legacy V2 generator
// carries an opaque interaction ID to the server. V3 transforms this component
// to emit only the browser query intent while leaving Search API behavior intact.
export function generatedStoreSearch() {
  return `"use client"

import { FormEvent, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

type StoreSearchProps = {
  initialQuery?: string
}

function createSearchInteractionId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return \`search:\${crypto.randomUUID()}\`
    }
  } catch {
    // Tracking identity generation must not block navigation.
  }
  return \`search:\${Date.now().toString(36)}:\${Math.random().toString(36).slice(2, 14)}\`
}

const StoreSearch = ({ initialQuery = "" }: StoreSearchProps) => {
  const [query, setQuery] = useState(initialQuery)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => setQuery(initialQuery), [initialQuery])

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedQuery = query.trim()

    const params = new URLSearchParams(searchParams.toString())
    params.delete("page")
    if (normalizedQuery) {
      params.set("q", normalizedQuery)
      params.set("fm_search_interaction_id", createSearchInteractionId())
    } else {
      params.delete("q")
      params.delete("fm_search_interaction_id")
    }

    const queryString = params.toString()
    router.push(queryString ? \`\${pathname}?\${queryString}\` : pathname)
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-xl gap-2" role="search">
      <label className="sr-only" htmlFor="store-search">Search products</label>
      <input
        id="store-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the collection"
        className="min-w-0 flex-1 rounded-full border border-ui-border-base bg-white px-4 py-2 text-sm text-ui-fg-base outline-none transition focus:border-ui-fg-base"
      />
      <button
        type="submit"
        className="rounded-full bg-ui-fg-base px-5 py-2 text-sm font-semibold text-ui-bg-base transition hover:opacity-90"
      >
        Search
      </button>
    </form>
  )
}

export default StoreSearch
`
}

export function generatedBrowserStoreSearch() {
  return generatedStoreSearch()
    .replace('import { usePathname, useRouter, useSearchParams } from "next/navigation"',
      'import { usePathname, useRouter, useSearchParams } from "next/navigation"\nimport { trackSearchQuery } from "@funnelmetry/client"')
    .replace('      params.set("fm_search_interaction_id", createSearchInteractionId())',
      '      void trackSearchQuery(query, createSearchInteractionId())')
    .replace('    params.delete("page")',
      '    params.delete("page")\n    params.delete("fm_search_interaction_id")')
    .replace('      params.delete("fm_search_interaction_id")\n', '')
}
