import { Suspense } from "react"

import { OptionValueIds } from "@lib/util/product-option-filters"
import SkeletonProductGrid from "@modules/skeletons/templates/skeleton-product-grid"
import RefinementList from "@modules/store/components/refinement-list"
import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

import PaginatedProducts from "./paginated-products"

const StoreTemplate = ({
  sortBy,
  page,
  countryCode,
  optionValueIds,
}: {
  sortBy?: SortOptions
  page?: string
  countryCode: string
  optionValueIds?: OptionValueIds
}) => {
  const pageNumber = page ? parseInt(page) : 1
  const sort = sortBy || "created_at"

  return (
    <div
      className="content-container flex flex-col gap-8 py-10 small:flex-row small:items-start small:gap-12 small:py-16"
      data-testid="category-container"
    >
      <RefinementList sortBy={sort} />
      <div className="w-full">
        <div className="mb-10 border-b border-ui-border-base pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ui-fg-subtle">
            The full edit
          </p>
          <h1 className="mt-3 text-4xl font-medium tracking-[-0.03em] text-ui-fg-base" data-testid="store-page-title">
            All products
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ui-fg-subtle">
            Browse the complete Northstar collection and find the pieces that fit your everyday.
          </p>
        </div>
        <Suspense fallback={<SkeletonProductGrid />}>
          <PaginatedProducts
            sortBy={sort}
            page={pageNumber}
            countryCode={countryCode}
            optionValueIds={optionValueIds}
          />
        </Suspense>
      </div>
    </div>
  )
}

export default StoreTemplate
