import { useState, useEffect } from 'react';
import { generatorApi } from '../services/generatorApi';

export function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [lastCheck, setLastCheck] = useState<string>('');

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkConnection = async () => {
    try {
      const result = await generatorApi.health();
      setIsOnline(result.ok);
      setLastCheck(new Date().toLocaleTimeString());
    } catch {
      setIsOnline(false);
      setLastCheck(new Date().toLocaleTimeString());
    }
  };

  if (isOnline === null) {
    return (
      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4 flex items-center">
        <div className="animate-spin h-5 w-5 border-2 border-gray-400 border-t-transparent rounded-full mr-3"></div>
        <span className="text-gray-700 dark:text-gray-300">Checking API connection...</span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg p-4 flex items-center justify-between ${
      isOnline 
        ? 'bg-green-100 dark:bg-green-900/30' 
        : 'bg-red-100 dark:bg-red-900/30'
    }`}>
      <div className="flex items-center">
        <span className={`h-3 w-3 rounded-full mr-3 ${
          isOnline ? 'bg-green-500' : 'bg-red-500'
        } ${isOnline ? 'animate-pulse' : ''}`}></span>
        <span className={`font-medium ${
          isOnline 
            ? 'text-green-800 dark:text-green-200' 
            : 'text-red-800 dark:text-red-200'
        }`}>
          {isOnline ? 'API Online' : 'API Offline'}
        </span>
      </div>
      <span className="text-sm text-gray-600 dark:text-gray-400">
        Last check: {lastCheck}
      </span>
    </div>
  );
}
