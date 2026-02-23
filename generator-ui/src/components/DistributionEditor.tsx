import { useState, useEffect } from 'react';
import { generatorApi } from '../services/generatorApi';
import type { Distribution } from '../types';

export function DistributionEditor() {
  const [distribution, setDistribution] = useState<Distribution>({
    order_created: 30,
    payment_initiated: 25,
    payment_success: 35,
    payment_failed: 8,
    order_cancelled: 2
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await generatorApi.getConfig();
      setDistribution(config.distribution);
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  const handleChange = (key: keyof Distribution, value: number) => {
    setDistribution(prev => ({ ...prev, [key]: value }));
    setSuccess(false);
  };

  const total = Object.values(distribution).reduce((sum, val) => sum + val, 0);
  const isValid = Math.abs(total - 100) < 0.01;

  const handleSave = async () => {
    if (!isValid) {
      setError('Total must equal 100%');
      return;
    }

    try {
      setLoading(true);
      setError('');
      
      await generatorApi.updateConfig({ distribution });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update config');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Distribution Editor</h2>
      
      <div className="space-y-4">
        {Object.entries(distribution).map(([key, value]) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 capitalize">
              {key.replace(/_/g, ' ')}: {value}%
            </label>
            <input
              type="number"
              value={value}
              onChange={(e) => handleChange(key as keyof Distribution, Number(e.target.value))}
              min="0"
              max="100"
              step="0.1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
          </div>
        ))}

        <div className={`text-sm font-medium ${isValid ? 'text-green-600' : 'text-red-600'}`}>
          Total: {total.toFixed(1)}% {isValid ? '✓' : '✗ Must equal 100%'}
        </div>

        {error && (
          <div className="text-red-600 text-sm">{error}</div>
        )}

        {success && (
          <div className="text-green-600 text-sm">Configuration updated successfully!</div>
        )}

        <button
          onClick={handleSave}
          disabled={loading || !isValid}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md transition"
        >
          {loading ? 'Saving...' : 'Save Distribution'}
        </button>
      </div>
    </div>
  );
}
