import React, { useState, useEffect } from 'react';

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

  useEffect(() => {
    if (serverInfo) {
      console.log('Preview pane serverInfo changed:', serverInfo);
      setIsLoading(true);
      setHasError(false);
    }
  }, [serverInfo]);

  const handleIframeLoad = (): void => {
    console.log('Preview iframe loaded successfully');
    setIsLoading(false);
  };

  const handleIframeError = (): void => {
    console.log('Preview iframe error occurred');
    setIsLoading(false);
    setHasError(true);
  };

  const refreshPreview = (): void => {
    setIsLoading(true);
    setHasError(false);
    // Force iframe reload by changing its src
    const iframe = document.getElementById('preview-iframe') as HTMLIFrameElement;
    if (iframe && serverInfo) {
      const currentSrc = iframe.src;
      iframe.src = '';
      iframe.src = currentSrc;
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Preview</h3>
        {serverInfo && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">
              Port {serverInfo.port}
            </span>
            <button
              onClick={refreshPreview}
              className="text-gray-400 hover:text-gray-600 transition-colors"
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
              <p className="text-sm mb-4">Failed to load preview</p>
              <button
                onClick={refreshPreview}
                className="bg-blue-500 text-white px-4 py-2 rounded text-sm hover:bg-blue-600"
              >
                Try Again
              </button>
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
              id="preview-iframe"
              src={serverInfo.url}
              className="w-full h-full border-0"
              onLoad={handleIframeLoad}
              onError={handleIframeError}
              title="App Preview"
              // Remove sandbox for WebContainer content - it's already isolated
            />
          </>
        )}
      </div>
    </div>
  );
};

export default PreviewPane; 