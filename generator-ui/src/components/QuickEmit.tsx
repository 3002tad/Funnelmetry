import { useState } from 'react';
import { generatorApi } from '../services/generatorApi';
import type { Event, EmitRequest } from '../types';

interface QuickEmitProps {
  onEventEmitted: (event: Event) => void;
}

export function QuickEmit({ onEventEmitted }: QuickEmitProps) {
  const [eventType, setEventType] = useState('payment_success');
  const [device, setDevice] = useState('mobile');
  const [amount, setAmount] = useState(1000000);
  const [lateMinutes, setLateMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmit = async () => {
    try {
      setLoading(true);
      setError('');
      
      const request: EmitRequest = {
        eventType,
        lateMinutes: lateMinutes > 0 ? lateMinutes : undefined
      };

      // Only include amount for payment_success
      if (eventType === 'payment_success') {
        request.amount = amount;
      }

      const event = await generatorApi.emitEvent(request);
      onEventEmitted(event);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to emit event');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Quick Emit</h2>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Event Type
          </label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="order_created">Order Created</option>
            <option value="payment_initiated">Payment Initiated</option>
            <option value="payment_success">Payment Success</option>
            <option value="payment_failed">Payment Failed</option>
            <option value="order_cancelled">Order Cancelled</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Device
          </label>
          <select
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="mobile">Mobile</option>
            <option value="desktop">Desktop</option>
            <option value="tablet">Tablet</option>
          </select>
        </div>

        {eventType === 'payment_success' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Amount (VND)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              min="50000"
              max="5000000"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Late Event (minutes)
          </label>
          <select
            value={lateMinutes}
            onChange={(e) => setLateMinutes(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="0">On time (0 min)</option>
            <option value="1">1 minute late</option>
            <option value="3">3 minutes late</option>
            <option value="5">5 minutes late</option>
          </select>
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        <button
          onClick={handleEmit}
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition"
        >
          {loading ? 'Emitting...' : 'Emit 1 Event'}
        </button>
      </div>
    </div>
  );
}
