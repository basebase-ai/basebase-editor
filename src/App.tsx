import React, { useEffect, useState } from 'react';
import GitHubAuth from './components/GitHubAuth';
import DevEnvironment from './components/DevEnvironment';
import WebContainerManager from './utils/webcontainer-manager';

interface AppState {
  githubToken: string | null;
  repoUrl: string | null;
  showAuth: boolean;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    githubToken: null,
    repoUrl: null,
    showAuth: false
  });

  useEffect(() => {
    // Parse repo URL from query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const repoParam = urlParams.get('repo');
    
    if (!repoParam) {
      // Show error if no repo specified
      setState(prev => ({ ...prev, repoUrl: null }));
      return;
    }

    // Check if we have a GitHub token
    const savedToken = localStorage.getItem('github_token');
    
    setState(prev => ({
      ...prev,
      repoUrl: repoParam,
      githubToken: savedToken,
      showAuth: !savedToken
    }));

    // Cleanup WebContainer when page is about to unload
    const handleBeforeUnload = () => {
      WebContainerManager.teardown();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      WebContainerManager.teardown();
    };
  }, []);

  const handleAuthSuccess = (token: string): void => {
    setState(prev => ({ 
      ...prev, 
      githubToken: token, 
      showAuth: false 
    }));
  };



  // Show error if no repo URL provided
  if (!state.repoUrl) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center mb-6">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Repository Required</h2>
            <p className="text-gray-600 mb-6">
              Please specify a GitHub repository URL in the query parameter.
            </p>
            <div className="bg-gray-50 rounded p-4 text-left">
              <code className="text-sm text-gray-700">
                {window.location.origin}?repo=https://github.com/owner/repo
              </code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show GitHub auth if needed
  if (state.showAuth) {
    return (
      <GitHubAuth 
        onAuthSuccess={handleAuthSuccess}
      />
    );
  }

  // Show main editor interface
  return (
    <DevEnvironment 
      githubToken={state.githubToken}
      repoUrl={state.repoUrl}
    />
  );
};

export default App;
