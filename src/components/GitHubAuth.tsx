import React, { useState, useEffect } from 'react';

interface GitHubAuthProps {
  onAuthSuccess: (token: string) => void;
}

const GitHubAuth: React.FC<GitHubAuthProps> = ({ onAuthSuccess }) => {
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if we already have a token in localStorage
    const savedToken = localStorage.getItem('github_token');
    if (savedToken) {
      onAuthSuccess(savedToken);
    }
  }, [onAuthSuccess]);

  const handleGitHubAuth = (): void => {
    setIsAuthenticating(true);
    setError(null);

    // For now, we'll use a simple token input
    // In production, you'd implement proper OAuth flow
    const token = prompt('Please enter your GitHub Personal Access Token:');
    
    if (token) {
      // Store the token
      localStorage.setItem('github_token', token);
      setIsAuthenticating(false);
      onAuthSuccess(token);
    } else {
      setIsAuthenticating(false);
      setError('GitHub token is required to continue');
    }
  };

  const handleManualTokenEntry = (): void => {
    window.open('https://github.com/settings/tokens/new?scopes=repo&description=BaseBase%20Development%20Environment', '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative">
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="text-sm text-gray-500">BaseBase Editor</h1>
        </div>

        {/* Modal content */}
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-r from-gray-800 to-black rounded-full mx-auto flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 0C4.477 0 0 4.484 0 10.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0110 4.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.942.359.31.678.921.678 1.856 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0020 10.017C20 4.484 15.522 0 10 0z" clipRule="evenodd" />
            </svg>
          </div>
          
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Connect GitHub Account
          </h2>
          
          <p className="text-gray-600 mb-6 leading-relaxed">
            To save the changes you make to this project, we need access to your GitHub account.
            You'll need a Personal Access Token with repository permissions.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          
          <div className="space-y-3">
            <button
              onClick={handleGitHubAuth}
              disabled={isAuthenticating}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold py-3 px-6 rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 transform hover:scale-105 disabled:opacity-50 disabled:transform-none"
            >
              {isAuthenticating ? 'Authenticating...' : 'Enter GitHub Token'}
            </button>
            
            <button
              onClick={handleManualTokenEntry}
              className="w-full bg-gray-100 text-gray-700 font-semibold py-2 px-6 rounded-lg hover:bg-gray-200 transition-all duration-200 text-sm"
            >
              Create New Token on GitHub
            </button>
          </div>

          <div className="mt-6 text-xs text-gray-500">
            <p>We only use your token to access repositories. It's stored locally and never sent to our servers.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitHubAuth; 