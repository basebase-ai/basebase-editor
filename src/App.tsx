import React, { useEffect, useState } from 'react';
import GitHubAuth from './components/GitHubAuth';
import DevEnvironment from './components/DevEnvironment';
import WebContainerManager from './utils/webcontainer-manager';

interface AppState {
  githubToken: string | null;
  repoUrl: string | null;
  basebaseToken: string | null;
  basebaseProject: string | null;
  showAuth: boolean;
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    githubToken: null,
    repoUrl: null,
    basebaseToken: null,
    basebaseProject: null,
    showAuth: false
  });

  useEffect(() => {
    // Parse repo URL, token, and project from query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const repoParam = urlParams.get('repo');
    const tokenParam = urlParams.get('token');
    const projectParam = urlParams.get('project');
    
    // Handle repository URL
    let repoUrl: string | null = null;
    if (repoParam) {
      // Store repo locally and use it
      localStorage.setItem('basebase_repo', repoParam);
      repoUrl = repoParam;
    } else {
      // Check if we have a saved repo
      repoUrl = localStorage.getItem('basebase_repo');
    }

    if (!repoUrl) {
      // Show error if no repo specified and none saved
      setState(prev => ({ ...prev, repoUrl: null }));
      return;
    }

    // Handle Basebase token if provided
    let basebaseToken: string | null = null;
    if (tokenParam) {
      // Store token locally
      localStorage.setItem('basebase_token', tokenParam);
      basebaseToken = tokenParam;
    } else {
      // Check if we have a saved token
      basebaseToken = localStorage.getItem('basebase_token');
    }

    // Handle Basebase project if provided
    let basebaseProject: string | null = null;
    if (projectParam) {
      // Store project locally
      localStorage.setItem('basebase_project', projectParam);
      basebaseProject = projectParam;
    } else {
      // Check if we have a saved project
      basebaseProject = localStorage.getItem('basebase_project');
    }

    // Remove sensitive parameters from URL immediately for security
    // Keep project param for better UX, but remove token (sensitive) and repo (long URL)
    if (tokenParam || repoParam) {
      const newUrl = new URL(window.location.href);
      if (tokenParam) newUrl.searchParams.delete('token');
      if (repoParam) newUrl.searchParams.delete('repo');
      window.history.replaceState({}, document.title, newUrl.toString());
    }

    // Check if we have a GitHub token
    const savedToken = localStorage.getItem('github_token');
    
    setState(prev => ({
      ...prev,
      repoUrl,
      githubToken: savedToken,
      basebaseToken,
      basebaseProject,
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
      basebaseToken={state.basebaseToken}
      basebaseProject={state.basebaseProject}
    />
  );
};

export default App;
