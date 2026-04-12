import { useState, useEffect, useRef, useCallback } from "react";
import { generatorApi } from "../services/generatorApi";
import type { Event } from "../types";
import EmitWorker from "../workers/emitWorker?worker";

interface AutoEmitProps {
  onEventEmitted: (event: Event) => void;
}

export function AutoEmit({ onEventEmitted }: AutoEmitProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [ratePerSec, setRatePerSec] = useState(50);
  const [emittedCount, setEmittedCount] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(false);

  // Batch size per tick — emit in chunks for higher throughput
  // Tick every 200ms, batch = ratePerSec / 5
  const batchSize = Math.max(1, Math.round(ratePerSec / 5));
  const tickMs = 200;

  const handleTick = useCallback(async () => {
    if (pendingRef.current) return; // skip if previous batch still in-flight
    pendingRef.current = true;
    try {
      const result = await generatorApi.emitBatch(batchSize);
      if (result.events && result.events.length > 0) {
        onEventEmitted(result.events[0]);
      }
      setEmittedCount((prev) => prev + (result.count || batchSize));
    } catch (err) {
      console.error("Auto emit error:", err);
    } finally {
      pendingRef.current = false;
    }
  }, [batchSize, onEventEmitted]);

  useEffect(() => {
    if (isRunning) {
      const worker = new EmitWorker();
      workerRef.current = worker;

      worker.onmessage = () => {
        handleTick();
      };

      worker.postMessage({ type: "start", intervalMs: tickMs });
    } else {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "stop" });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "stop" });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [isRunning, handleTick]);

  const toggleAutoEmit = () => {
    if (isRunning) {
      setIsRunning(false);
    } else {
      setEmittedCount(0);
      pendingRef.current = false;
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
              Running ({emittedCount.toLocaleString()} emitted)
            </span>
          </span>
        )}
      </h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Rate: ~{ratePerSec} events/sec (batch {batchSize} x 5/sec)
          </label>
          <input
            type="range"
            value={ratePerSec}
            onChange={(e) => setRatePerSec(Number(e.target.value))}
            min="5"
            max="500"
            step="5"
            disabled={isRunning}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>5/sec</span>
            <span>500/sec</span>
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
            Emitting ~{ratePerSec} events/sec — works in background tabs
          </p>
        )}
      </div>
    </div>
  );
}
