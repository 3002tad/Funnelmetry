import { Router } from "express"
import { query } from "../db.js"
import { createV2AnalyticsRepository } from "../lib/v2-analytics-repository.js"
import { ANALYTICS_V2_PATHS } from "../lib/v2-analytics-contract.js"
import { parseEventFilters, parseJourneyId, parseListLimit, parseProfileIdentity, parseV2AnalyticsQuery } from "../lib/v2-analytics-query.js"

function badRequest(res, error) {
  return res.status(400).json({ error: "invalid_query", message: error.message })
}

function failed(res, route, error) {
  console.error(route, error.message)
  return res.status(500).json({ error: "query_failed" })
}

export function createAnalyticsV2Router(repository = createV2AnalyticsRepository({ query })) {
  const router = Router()

  router.get(ANALYTICS_V2_PATHS.overview, async (req, res) => {
    let scope
    try {
      scope = parseV2AnalyticsQuery(req.query)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      return res.json(await repository.getOverview(scope))
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/overview", error)
    }
  })

  router.get(ANALYTICS_V2_PATHS.funnel, async (req, res) => {
    let scope
    let identity
    try {
      scope = parseV2AnalyticsQuery(req.query)
      identity = parseProfileIdentity(req.params.profileId, req.query.profile_version)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      const funnel = await repository.getFunnel(scope, identity)
      if (!funnel) return res.status(404).json({ error: "funnel_profile_not_found" })
      return res.json(funnel)
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/funnels/:profileId", error)
    }
  })

  router.get(ANALYTICS_V2_PATHS.journeys, async (req, res) => {
    let scope
    let limit
    try {
      scope = parseV2AnalyticsQuery(req.query)
      limit = parseListLimit(req.query.limit)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      const journeys = await repository.listJourneys({ sourceId: scope.sourceId, limit })
      return res.json({ source_id: scope.sourceId, limit, journeys })
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/journeys", error)
    }
  })

  router.get(ANALYTICS_V2_PATHS.journey, async (req, res) => {
    let scope
    let journeyId
    try {
      scope = parseV2AnalyticsQuery(req.query)
      journeyId = parseJourneyId(req.params.journeyId)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      const journey = await repository.getJourney(scope.sourceId, journeyId)
      if (!journey) return res.status(404).json({ error: "journey_not_found" })
      return res.json(journey)
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/journeys/:journeyId", error)
    }
  })

  router.get(ANALYTICS_V2_PATHS.events, async (req, res) => {
    let scope
    let filters
    try {
      scope = parseV2AnalyticsQuery(req.query)
      filters = parseEventFilters(req.query)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      const events = await repository.listEvents(scope, filters)
      return res.json({
        source_id: scope.sourceId,
        window: { basis: "occurred_at", from: scope.from, to: scope.to },
        limit: filters.limit,
        events,
      })
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/events", error)
    }
  })

  router.get(ANALYTICS_V2_PATHS.dataHealth, async (req, res) => {
    let scope
    try {
      scope = parseV2AnalyticsQuery(req.query)
    } catch (error) {
      return badRequest(res, error)
    }
    try {
      return res.json(await repository.getDataHealth(scope))
    } catch (error) {
      return failed(res, "GET /api/v2/analytics/data-health", error)
    }
  })

  return router
}

export const analyticsV2Router = createAnalyticsV2Router()
