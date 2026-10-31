import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { generatedBrowserClient } from "./browser-client-template.mjs"
import { generatedBrowserStoreSearch } from "./store-search.mjs"

const browserSdkVersion = "0.4.0"
const paths = {
  rootPackage: "package.json", backendPackage: "apps/backend/package.json",
  storefrontPackage: "apps/storefront/package.json", storefrontTsConfig: "apps/storefront/tsconfig.json",
  layout: "apps/storefront/src/app/layout.tsx",
  productPage: "apps/storefront/src/app/[countryCode]/(main)/products/[handle]/page.tsx",
  productActions: "apps/storefront/src/modules/products/components/product-actions/index.tsx",
  checkoutPage: "apps/storefront/src/app/[countryCode]/(checkout)/checkout/page.tsx",
  cartData: "apps/storefront/src/lib/data/cart.ts",
  storeSearch: "apps/storefront/src/modules/store/components/store-search/index.tsx",
  storePage: "apps/storefront/src/app/[countryCode]/(main)/store/page.tsx",
  storeTemplate: "apps/storefront/src/modules/store/templates/index.tsx",
  products: "apps/storefront/src/modules/store/templates/paginated-products.tsx",
  subscriberDirectory: "apps/backend/src/subscribers",
}
const generated = {
  client: "apps/storefront/src/funnelmetry/client.tsx", consent: "apps/storefront/src/funnelmetry/consent-notice.tsx",
  cartProfile: "funnelmetry/cdc-cart-line-item.json", orderProfile: "funnelmetry/cdc-order-v2-shadow.json",
  catalogProfile: "funnelmetry/cdc-catalog-shadow.json", inventoryProfile: "funnelmetry/cdc-inventory-price-shadow.json",
}
const retired = {
  files: ["apps/storefront/src/funnelmetry/server-delivery.ts", "apps/backend/src/funnelmetry/managed-delivery-dispatcher.ts",
    "apps/backend/src/funnelmetry/occurred-at.ts", "apps/backend/src/subscribers/funnelmetry-order-placed.ts",
    "funnelmetry/cdc-reference-shadow.json"],
  dependency: "@3002tad/funnelmetry-backend-integration-kit",
}
const text = value => String(value ?? "").replace(/\r\n/g, "\n")
async function read(root, file, optional = false) {
  try { return await readFile(path.join(root, file), "utf8") }
  catch (error) { if (optional && error?.code === "ENOENT") return null; throw error }
}
function replaceOnce(content, search, replacement, file) {
  if (!content.includes(search)) throw new Error(`Pinned Medusa layout changed: cannot patch ${file}`)
  return content.replace(search, replacement)
}
function dependency(content, name, version, file) {
  let document
  try { document = JSON.parse(content) } catch { throw new Error(`Invalid JSON in ${file}`) }
  const dependencies = { ...(document.dependencies ?? {}) }
  if (version === null) delete dependencies[name]; else dependencies[name] = version
  return `${JSON.stringify({ ...document, dependencies }, null, 2)}\n`
}
function alias(content) {
  const document = JSON.parse(content); const compilerOptions = { ...(document.compilerOptions ?? {}) }
  compilerOptions.paths = { ...(compilerOptions.paths ?? {}), "@funnelmetry/*": ["funnelmetry/*"] }
  return `${JSON.stringify({ ...document, compilerOptions }, null, 2)}\n`
}
function consent(manifest) {
  const key = JSON.stringify(`funnelmetry.browser.consent.v1.${manifest.source.id}`)
  return `"use client"\n\nimport { useEffect, useState } from "react"\n\nconst consentStorageKey = ${key}\ndeclare global { interface Window { __FUNNELMETRY_CONSENT__?: boolean } }\nfunction stored() { if (typeof window === "undefined") return false; try { return localStorage.getItem(consentStorageKey) === "granted" } catch { return false } }\nfunction restore() { if (typeof window !== "undefined") window.__FUNNELMETRY_CONSENT__ = stored() }\nrestore()\nexport function FunnelmetryConsentNotice() {\n  const [open, setOpen] = useState(false)\n  useEffect(() => { restore(); setOpen(!stored()) }, [])\n  if (!open) return null\n  return <aside aria-describedby="funnelmetry-tracking-description" aria-labelledby="funnelmetry-tracking-title" role="dialog" style={{background:"#fff",bottom:"1.5rem",left:"50%",padding:"1.25rem",position:"fixed",transform:"translateX(-50%)",zIndex:100}}>\n    <button aria-label="Agree to tracking and close this notice" onClick={() => { try { localStorage.setItem(consentStorageKey,"granted") } catch {} window.__FUNNELMETRY_CONSENT__=true; setOpen(false); location.reload() }} type="button">&times;</button>\n    <h2 id="funnelmetry-tracking-title">Tracking notice</h2><p id="funnelmetry-tracking-description">Funnelmetry uses anonymous interaction data to understand the shopping journey. Closing this notice enables tracking for this browser.</p>\n  </aside>\n}\n`
}
const json = value => `${JSON.stringify(value, null, 2)}\n`
function profileFiles(manifest) {
  const base = { generated_by: "funnelmetry-medusa-ci", source_id: manifest.source.id, medusa_version: manifest.host.medusaVersion }
  const order = manifest.cdcOrderV2Shadow, catalog = manifest.cdcCatalogShadow
  const inventory = manifest.cdcInventoryPriceShadow, cart = manifest.cdcCartLineItem
  return {
    [generated.orderProfile]: json({ schema_version:"funnelmetry-medusa-cdc-order-v2-shadow.v1",...base,status:"SHADOW_ONLY",cdc_reference_contract:order.profile,coverage_epoch_id:order.coverageEpochId,snapshot_mode:order.snapshotMode,baseline_policy:"BASELINE_NEVER_ON",historical_gap_status:"INCOMPLETE",source_db_url_ref:order.sourceDbUrlRef,source_owner:order.sourceOwner,pipeline_owner:order.pipelineOwner,publication:order.publication,slot:order.slot,topic_prefix:order.topicPrefix,fact_topic:order.factTopic,table_columns:order.tableColumns,analytical_authority:order.profile,runtime_activation:"OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER" }),
    [generated.catalogProfile]: json({ schema_version:"funnelmetry-medusa-cdc-catalog-shadow.v2",...base,status:"SHADOW_ONLY",cdc_catalog_contract:catalog.profile,source_db_url_ref:catalog.sourceDbUrlRef,source_owner:catalog.sourceOwner,pipeline_owner:catalog.pipelineOwner,snapshot_mode:catalog.snapshotMode,coverage_epoch_id:catalog.coverageEpochId,publication:catalog.publication,slot:catalog.slot,topic_prefix:catalog.topicPrefix,table_columns:catalog.tableColumns,projection_stage:"PRODUCT_VARIANT_CATEGORY_ONLY",inventory_price_claims:"NOT_SUPPORTED",dashboard_cutover:"BLOCKED_PENDING_COVERAGE_AND_FRESHNESS",runtime_activation:"OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER" }),
    [generated.inventoryProfile]: json({ schema_version:"funnelmetry-medusa-cdc-inventory-price-shadow.v3",...base,status:"SHADOW_ONLY",cdc_inventory_price_contract:inventory.profile,source_db_url_ref:inventory.sourceDbUrlRef,source_owner:inventory.sourceOwner,pipeline_owner:inventory.pipelineOwner,snapshot_mode:inventory.snapshotMode,coverage_epoch_id:inventory.coverageEpochId,publication:inventory.publication,slot:inventory.slot,topic_prefix:inventory.topicPrefix,table_columns:inventory.tableColumns,projection_stage:"INVENTORY_PRICE_CONTEXT_ONLY",inventory_available_to_sell_claims:"NOT_PUBLISHED",storefront_display_price_claims:"NOT_PUBLISHED",historical_order_amount_restatement:"FORBIDDEN",runtime_activation:"OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER" }),
    [generated.cartProfile]: json({ schema_version:"funnelmetry-medusa-cdc-cart-line-item.v1",...base,status:"ACTIVE_REFERENCE",cdc_contract:cart.profile,snapshot_mode:cart.snapshotMode,baseline_policy:"SNAPSHOT_NEVER_EMITS_CART_ITEM_ADDED",quantity_policy:"INSERT_OR_POSITIVE_DELTA_ONLY",coverage_epoch_id:cart.coverageEpochId,source_db_url_ref:cart.sourceDbUrlRef,source_owner:cart.sourceOwner,pipeline_owner:cart.pipelineOwner,publication:cart.publication,slot:cart.slot,topic_prefix:cart.topicPrefix,table_columns:cart.tableColumns,runtime_activation:"OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER" }),
  }
}
function wholePatch(file, before, after) {
  const a = before === null ? [] : text(before).replace(/\n$/, "").split("\n"), b = text(after).replace(/\n$/, "").split("\n")
  const header = before === null ? `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${b.length} @@\n` : `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,${a.length} +1,${b.length} @@\n`
  return `${header}${[...a.map(v=>`-${v}`),...b.map(v=>`+${v}`)].join("\n")}\n`
}
function deletePatch(file,before){const a=text(before).replace(/\n$/,"").split("\n");return `diff --git a/${file} b/${file}\ndeleted file mode 100644\n--- a/${file}\n+++ /dev/null\n@@ -1,${a.length} +0,0 @@\n${a.map(v=>`-${v}`).join("\n")}\n`}
function fingerprint(values){const h=createHash("sha256");for(const key of Object.keys(values).sort())h.update(key).update("\0").update(String(values[key]??""));return h.digest("hex")}

function installHost(source) {
  const out=Object.fromEntries(Object.entries(source).map(([key,value])=>[key,value===null?null:text(value)]))
  if(!out[paths.layout].includes("FunnelmetryBootstrap")) out[paths.layout]=replaceOnce(out[paths.layout],'import "styles/globals.css"','import "styles/globals.css"\nimport { FunnelmetryBootstrap } from "@funnelmetry/client"\nimport { FunnelmetryConsentNotice } from "@funnelmetry/consent-notice"',paths.layout).replace("<body>{children}</body>","<body><FunnelmetryConsentNotice /><FunnelmetryBootstrap />{children}</body>")
  if(!out[paths.productPage].includes("FunnelmetryProductViewed")) out[paths.productPage]=replaceOnce(out[paths.productPage],'import ProductTemplate from "@modules/products/templates"','import ProductTemplate from "@modules/products/templates"\nimport { FunnelmetryProductViewed } from "@funnelmetry/client"',paths.productPage).replace("  return (\n    <ProductTemplate","  return (\n    <>\n      <FunnelmetryProductViewed productId={pricedProduct.id} />\n      <ProductTemplate").replace("    />\n  )","      />\n    </>\n  )")
  if(!out[paths.checkoutPage].includes("FunnelmetryCheckoutStarted")) out[paths.checkoutPage]=replaceOnce(out[paths.checkoutPage],'import CheckoutProgress from "@modules/checkout/components/checkout-progress"','import CheckoutProgress from "@modules/checkout/components/checkout-progress"\nimport { FunnelmetryCheckoutStarted } from "@funnelmetry/client"',paths.checkoutPage).replace("  return (\n    <div","  return (\n    <>\n      <FunnelmetryCheckoutStarted cartId={cart.id} />\n      <div").replace("    </div>\n  )","      </div>\n    </>\n  )")
  if(!out[paths.cartData].includes("return cart.id\n}")) out[paths.cartData]=replaceOnce(out[paths.cartData],"    .catch(medusaError)\n}\n\nexport async function updateLineItem","    .catch(medusaError)\n  return cart.id\n}\n\nexport async function updateLineItem",paths.cartData)
  if(!out[paths.productActions].includes("trackCartContext")) out[paths.productActions]=replaceOnce(out[paths.productActions],'import { addToCart } from "@lib/data/cart"','import { addToCart } from "@lib/data/cart"\nimport { trackCartContext } from "@funnelmetry/client"',paths.productActions).replace("    await addToCart({","    const cartId = await addToCart({").replace("      countryCode,\n    })","      countryCode,\n    })\n    if (cartId) void trackCartContext(cartId)")
  out[paths.storeSearch]=generatedBrowserStoreSearch()
  if(!out[paths.storePage].includes("q?: string")) out[paths.storePage]=out[paths.storePage].replace("  page?: string\n","  page?: string\n  q?: string\n").replace("  const { sortBy, page } = searchParams","  const { sortBy, page, q } = searchParams").replace("      optionValueIds={optionValueIds}",'      optionValueIds={optionValueIds}\n      query={typeof q === "string" ? q : undefined}')
  if(!out[paths.storeTemplate].includes("StoreSearch")) out[paths.storeTemplate]=out[paths.storeTemplate].replace('import { SortOptions } from "@modules/store/components/refinement-list/sort-products"','import { SortOptions } from "@modules/store/components/refinement-list/sort-products"\nimport StoreSearch from "@modules/store/components/store-search"').replace("  optionValueIds,\n}: {","  optionValueIds,\n  query,\n}: {").replace("  optionValueIds?: OptionValueIds\n}) => {","  optionValueIds?: OptionValueIds\n  query?: string\n}) => {").replace("        </div>\n        <Suspense",'          <div className="mt-6"><StoreSearch initialQuery={query} /></div>\n        </div>\n        <Suspense').replace("            optionValueIds={optionValueIds}\n","            optionValueIds={optionValueIds}\n            query={query}\n")
  if(!out[paths.products].includes("query?: string")) out[paths.products]=out[paths.products].replace("  order?: string\n}","  order?: string\n  q?: string\n}").replace("  optionValueIds,\n}: {","  optionValueIds,\n  query,\n}: {").replace("  optionValueIds?: OptionValueIds\n}) {","  optionValueIds?: OptionValueIds\n  query?: string\n}) {").replace("  const region = await getRegion(countryCode)",'  if (query?.trim()) queryParams["q"] = query.trim()\n\n  const region = await getRegion(countryCode)')
  return out
}

export async function inspectMedusa(root,manifest){await stat(path.join(root,paths.subscriberDirectory));const monorepo=JSON.parse(await read(root,paths.rootPackage)),backend=JSON.parse(await read(root,paths.backendPackage)),storefront=JSON.parse(await read(root,paths.storefrontPackage));if(monorepo.name!=="dtc-starter-monorepo"||!String(monorepo.packageManager??"").startsWith("pnpm@10"))throw new Error("Unsupported host");if(backend.dependencies?.["@medusajs/medusa"]!==manifest.host.medusaVersion)throw new Error("Unsupported Medusa version");if(!String(storefront.dependencies?.next??"").startsWith("15."))throw new Error("Unsupported storefront");return{actualMedusa:backend.dependencies["@medusajs/medusa"],next:storefront.dependencies.next}}
export async function createPlan(root,manifest){
  if(manifest.apiVersion!=="funnelmetry.io/v3")throw new Error("Only funnelmetry.io/v3 is supported")
  const host=await inspectMedusa(root,manifest),originals={}
  for(const file of Object.values(paths))if(file!==paths.subscriberDirectory)originals[file]=await read(root,file,file===paths.storeSearch)
  for(const file of [...Object.values(generated),...retired.files])originals[file]=await read(root,file,true)
  const expected=installHost(originals)
  expected[paths.storefrontTsConfig]=alias(originals[paths.storefrontTsConfig])
  expected[paths.storefrontPackage]=dependency(dependency(originals[paths.storefrontPackage],retired.dependency,null,paths.storefrontPackage),"@3002tad/funnelmetry-browser-sdk",browserSdkVersion,paths.storefrontPackage)
  expected[paths.backendPackage]=dependency(originals[paths.backendPackage],retired.dependency,null,paths.backendPackage)
  expected[generated.client]=generatedBrowserClient(manifest);expected[generated.consent]=consent(manifest);Object.assign(expected,profileFiles(manifest))
  const changes=[]
  for(const file of new Set([...Object.keys(expected),...retired.files])){const before=originals[file],after=retired.files.includes(file)?null:expected[file];if(before===null&&after===null)continue;if(after===null||text(before)!==text(after))changes.push({path:file,before,after})}
  return{schemaVersion:"funnelmetry-ci-plan.v4",mode:"plan-only",sourceMutation:false,integrationState:changes.length?(originals[generated.client]===null?"absent":"upgrade"):"exact",host,manifest,sourceFingerprint:fingerprint(originals),capabilities:{behavior:"ENABLED",searchSubmitted:"BROWSER_SDK",cartItemPersisted:"CDC_CONFIGURED",orderPlaced:"DISABLED",cdcCartState:"CDC_CONFIGURED",cdcOrderV2State:"CDC_PRIMARY_REFERENCE",cdcCatalogState:"CDC_PRIMARY_REFERENCE",cdcInventoryPriceState:"CDC_PRIMARY_REFERENCE"},changes:changes.map(({path:file})=>({path:file,ownership:"funnelmetry-installer"})),patch:changes.map(c=>c.after===null?deletePatch(c.path,c.before):wholePatch(c.path,c.before,c.after)).join("")}
}
export async function verifyIntegration(root,manifest){const plan=await createPlan(root,manifest);if(plan.changes.length)throw new Error(`Integration differs from manifest at ${plan.changes.map(c=>c.path).join(", ")}`);return{status:"pass",sourceMutation:false,integrationState:plan.integrationState,cdcOrderV2State:plan.capabilities.cdcOrderV2State,cdcCatalogState:plan.capabilities.cdcCatalogState,cdcInventoryPriceState:plan.capabilities.cdcInventoryPriceState,sourceFingerprint:plan.sourceFingerprint,runtimeConformance:"NOT_CHECKED_BY_INSTALLER"}}
