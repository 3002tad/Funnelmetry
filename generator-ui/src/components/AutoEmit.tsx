import { useState, useEffect, useRef } from "react";
import { generatorApi } from "../services/generatorApi";
import type { Event } from "../types";

interface AutoEmitProps {
  onEventEmitted: (event: Event) => void;
}

export function AutoEmit({ onEventEmitted }: AutoEmitProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [ratePerSec, setRatePerSec] = useState(1);
  const [emittedCount, setEmittedCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isRunning) {
      const intervalMs = 1000 / ratePerSec;

      intervalRef.current = setInterval(async () => {
        try {
          // Use POST /gen/emit (publishes to Kafka) instead of GET /gen/event (poller-only)
          const event = await generatorApi.emitEvent({});
          onEventEmitted(event);
          setEmittedCount((prev) => prev + 1);
        } catch (err) {
          console.error("Auto emit error:", err);
        }
      }, intervalMs);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isRunning, ratePerSec, onEventEmitted]);

  const toggleAutoEmit = () => {
    if (isRunning) {
      setIsRunning(false);
    } else {
      setEmittedCount(0);
      setIsRunning(true);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
        Auto Emit
        {isRunning && (
          <span className="ml-2 inline-flex items-center">
            <span className="animate-pulse h-3 w-3 bg-green-500 rounded-full mr-2"></span>
            <span className="text-sm font-normal text-green-600 dark:text-green-400">
              Running ({emittedCount} emitted)
            </span>
          </span>
        )}
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Rate per Second: {ratePerSec}
          </label>
          <input
            type="range"
            value={ratePerSec}
            onChange={(e) => setRatePerSec(Number(e.target.value))}
            min="1"
            max="100"
            disabled={isRunning}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>1/sec</span>
            <span>100/sec</span>
          </div>
        </div>

        <button
          onClick={toggleAutoEmit}
          className={`w-full font-medium py-2 px-4 rounded-md transition ${
            isRunning
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-purple-600 hover:bg-purple-700 text-white"
          }`}
        >
          {isRunning ? "Stop Auto Emit" : "Start Auto Emit"}
        </button>

        {isRunning && (
          <p className="text-xs text-gray-500 text-center">
            Emitting {ratePerSec} event{ratePerSec > 1 ? "s" : ""} per second
          </p>
        )}
      </div>
    </div>
  );
}
