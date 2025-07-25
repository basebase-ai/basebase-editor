import React, { useEffect, useRef } from 'react';

interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'error' | 'warn';
}

interface LogsModalProps {
  logs: LogEntry[];
  isOpen: boolean;
  onClose: () => void;
  onClearLogs: () => void;
}

const LogsModal: React.FC<LogsModalProps> = ({ logs, isOpen, onClose, onClearLogs }) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  if (!isOpen) {
    return null;
  }

  const getLogTypeColor = (type: LogEntry['type']): string => {
    switch (type) {
      case 'error':
        return 'text-red-600';
      case 'warn':
        return 'text-yellow-600';
      default:
        return 'text-gray-700';
    }
  };

  const formatTimestamp = (timestamp: Date): string => {
    return timestamp.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-3/4 mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-gray-900">Server Logs</h2>
            <span className="text-sm text-gray-500">({logs.length} entries)</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={onClearLogs}
              className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded hover:bg-gray-50"
            >
              Clear Logs
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Logs Content */}
        <div className="flex-1 overflow-hidden flex flex-col p-4">
          <div className="flex-1 overflow-y-auto bg-gray-50 rounded border p-3 font-mono text-sm">
            {logs.length === 0 ? (
              <div className="text-gray-500 text-center py-8">
                No logs yet. Logs will appear here when the server starts generating output.
              </div>
            ) : (
              <div className="space-y-1">
                {logs.map((log, index) => (
                  <div key={index} className="flex space-x-2">
                    <span className="text-gray-400 text-xs whitespace-nowrap">
                      [{formatTimestamp(log.timestamp)}]
                    </span>
                    <span className={`${getLogTypeColor(log.type)} flex-1 whitespace-pre-wrap break-words`}>
                      {log.message}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 text-xs text-gray-500">
          Real-time logs from the development server running in WebContainer
        </div>
      </div>
    </div>
  );
};

export default LogsModal; 