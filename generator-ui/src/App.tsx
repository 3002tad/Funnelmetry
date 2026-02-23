import { useState, useCallback, useEffect } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { QuickEmit } from "./components/QuickEmit";
import { BatchEmit } from "./components/BatchEmit";
import { AutoEmit } from "./components/AutoEmit";
import { DistributionEditor } from "./components/DistributionEditor";
import { EventLogTable } from "./components/EventLogTable";
import { generatorApi } from "./services/generatorApi";
import type { Event } from "./types";

function App() {
  const [events, setEvents] = useState<Event[]>([]);
  const [totalEvents, setTotalEvents] = useState(0);
  const [statusCounts, setStatusCounts] = useState({
    success: 0,
    pending: 0,
    failed: 0,
  });

  // Poll live events from dashboard-api (PostgreSQL) every 3 seconds
  useEffect(() => {
    const fetchLive = async () => {
      try {
        const {
          events: liveEvents,
          total,
          statusCounts: sc,
        } = await generatorApi.getLiveEvents(50);
        setEvents(liveEvents);
        setTotalEvents(total);
        setStatusCounts(sc);
      } catch {
        // dashboard-api not reachable — keep current state
      }
    };

    fetchLive(); // immediate first fetch
    const timer = setInterval(fetchLive, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleEventEmitted = useCallback((event: Event) => {
    setEvents((prev) => [event, ...prev].slice(0, 50));
  }, []);

  const handleEventsEmitted = useCallback((newEvents: Event[]) => {
    setEvents((prev) => [...newEvents, ...prev].slice(0, 50));
  }, []);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Event Generator Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Generate and monitor e-commerce events in real-time
          </p>
        </header>

        <div className="mb-6">
          <ConnectionStatus />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <QuickEmit onEventEmitted={handleEventEmitted} />
          <BatchEmit onEventsEmitted={handleEventsEmitted} />
          <AutoEmit onEventEmitted={handleEventEmitted} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1">
            <DistributionEditor />
          </div>
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
                Statistics
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {totalEvents}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Total Events
                  </div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {statusCounts.success}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Success
                  </div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded">
                  <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                    {statusCounts.pending}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Pending
                  </div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {statusCounts.failed}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Failed
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <EventLogTable events={events} totalEvents={totalEvents} />
      </div>
    </div>
  );
}

export default App;
