import React, { useEffect, useState } from 'react';
import GitHubAuth from './components/GitHubAuth';
import DevEnvironment from './components/DevEnvironment';
import ThemeToggle from './components/ThemeToggle';
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
    // Parse repo URL, token, and project from URL
    const urlParams = new URLSearchParams(window.location.search);
    const repoParam = urlParams.get('repo');
    const tokenParam = urlParams.get('token');
    
    // Extract project from path segment (first segment after /)
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    const projectParam = pathSegments.length > 0 ? pathSegments[0] : null;
    
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
    // Keep project param in path for better UX, but remove token (sensitive) and repo (long URL)
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
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center transition-colors">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 max-w-md w-full mx-4 transition-colors">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900 rounded-full mx-auto flex items-center justify-center mb-6 transition-colors">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4 transition-colors">Repository Required</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6 transition-colors">
              Please specify a GitHub repository URL in the query parameter.
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-4 text-left transition-colors">
              <code className="text-sm text-gray-700 dark:text-gray-300 transition-colors">
                {window.location.origin}/PROJECT?repo=https://github.com/owner/repo
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
      <div className="relative">
        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>
        <GitHubAuth 
          onAuthSuccess={handleAuthSuccess}
        />
      </div>
    );
  }

  // Show main editor interface
  return (
    <div className="relative">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      <DevEnvironment 
        githubToken={state.githubToken}
        repoUrl={state.repoUrl}
        basebaseToken={state.basebaseToken}
        basebaseProject={state.basebaseProject}
      />
    </div>
  );
};

export default App;
