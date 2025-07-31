import React, { useState, useEffect, useRef } from 'react';

interface ServerInfo {
  url: string;
  port: number;
}

interface PreviewPaneProps {
  serverInfo: ServerInfo | null;
}

const PreviewPane: React.FC<PreviewPaneProps> = ({ serverInfo }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const retryTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (serverInfo) {
      console.log('Preview pane serverInfo changed:', serverInfo);
      setIsLoading(true);
      setHasError(false);
      setRetryCount(0);
      setIsRetrying(false);
      
      // Clear any existing retry timeout
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    }
  }, [serverInfo]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const checkServerHealth = async (url: string): Promise<boolean> => {
    try {
      await fetch(url, { 
        method: 'GET',
        mode: 'no-cors', // Avoid CORS issues for health check
        cache: 'no-cache'
      });
      return true; // If fetch doesn't throw, server is responding
    } catch (error) {
      console.log('Server health check failed:', error);
      return false;
    }
  };

  const refreshPreview = (): void => {
    setIsLoading(true);
    setHasError(false);
    setIsRetrying(false);
    // Force iframe reload by changing its src
    if (iframeRef.current && serverInfo) {
      const currentSrc = iframeRef.current.src;
      iframeRef.current.src = '';
      iframeRef.current.src = currentSrc;
    }
  };

  const scheduleRetry = (): void => {
    if (!serverInfo || retryCount >= 10) return; // Max 10 retries
    
    setIsRetrying(true);
    const delay = Math.min(1000 + retryCount * 500, 5000); // Exponential backoff, max 5s
    
    console.log(`🔄 Scheduling retry ${retryCount + 1} in ${delay}ms`);
    
    retryTimeoutRef.current = window.setTimeout(async () => {
      if (!serverInfo) return;
      
      console.log(`🔍 Checking if server is ready (attempt ${retryCount + 1})`);
      const isHealthy = await checkServerHealth(serverInfo.url);
      
      if (isHealthy) {
        console.log('✅ Server is ready, refreshing iframe');
        setRetryCount(prev => prev + 1);
        setIsRetrying(false);
        refreshPreview();
      } else {
        console.log('❌ Server not ready yet, will retry');
        setRetryCount(prev => prev + 1);
        scheduleRetry();
      }
    }, delay);
  };

  const handleIframeLoad = (): void => {
    console.log('Preview iframe loaded successfully');
    setIsLoading(false);
    
    // Note: Cannot add iframe error listeners due to cross-origin restrictions
    // The iframe is running on a different origin (WebContainer) than the parent frame
    console.log('✅ Iframe loaded - cross-origin restrictions prevent deeper error monitoring');
  };

  const handleIframeError = (): void => {
    console.log('Preview iframe error occurred');
    setIsLoading(false);
    setHasError(true);
    
    // Automatically start retry process if server might not be ready yet
    if (serverInfo && retryCount < 10) {
      console.log('🔄 Starting automatic retry process');
      scheduleRetry();
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 border-b dark:border-gray-700 flex items-center justify-between transition-colors">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors">Preview</h3>
        {serverInfo && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 transition-colors">
              Port {serverInfo.port}
            </span>
            <button
              onClick={refreshPreview}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
              title="Refresh preview"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        )}
      </div>
      
      <div className="flex-1 relative">
        {!serverInfo ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-4">🚀</div>
              <p className="text-sm">Starting development server...</p>
              <div className="mt-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-300 mx-auto"></div>
              </div>
            </div>
          </div>
        ) : hasError ? (
          <div className="h-full flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-4">⚠️</div>
              <p className="text-sm mb-4">
                {isRetrying ? `Retrying connection (attempt ${retryCount}/10)...` : 'Failed to load preview'}
              </p>
              {isRetrying ? (
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4"></div>
              ) : (
                <button
                  onClick={refreshPreview}
                  className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600"
                >
                  Try Again
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 bg-white flex items-center justify-center z-10">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-sm text-gray-600">Loading preview...</p>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
              src={serverInfo.url}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title="App Preview"
              allow="cross-origin-isolated; autoplay; camera; microphone; geolocation; fullscreen; picture-in-picture"
              referrerPolicy="origin-when-cross-origin"
              loading="eager"
              // Remove sandbox for WebContainer content - it's already isolated
            />
          </>
        )}
      </div>
    </div>
  );
};

export default PreviewPane; 