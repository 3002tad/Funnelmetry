import { useState } from "react";
import { generatorApi } from "../services/generatorApi";
import type { Event } from "../types";

interface BatchEmitProps {
  onEventsEmitted: (events: Event[]) => void;
}

export function BatchEmit({ onEventsEmitted }: BatchEmitProps) {
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleEmit = async () => {
    try {
      setLoading(true);
      setError("");
      // Use POST /gen/emit-batch (publishes to Kafka) instead of GET /gen/events (poller-only)
      const result = await generatorApi.emitBatch(count);
      onEventsEmitted(result.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to emit events");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
        Batch Emit
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Number of Events
          </label>
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            min="1"
            max="500"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          />
          <p className="text-xs text-gray-500 mt-1">Max: 500 events</p>
        </div>

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <button
          onClick={handleEmit}
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition"
        >
          {loading ? "Emitting..." : `Emit ${count} Events`}
        </button>
      </div>
    </div>
  );
}
