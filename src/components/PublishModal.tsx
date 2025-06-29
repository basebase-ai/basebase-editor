import React, { useState } from 'react';
import { Octokit } from '@octokit/rest';

interface PublishModalProps {
  repoUrl: string;
  githubToken: string | null;
  onClose: () => void;
}

const PublishModal: React.FC<PublishModalProps> = ({ repoUrl, githubToken, onClose }) => {
  const [branchName, setBranchName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    
    if (!githubToken) {
      setError('GitHub token is required');
      return;
    }

    if (!branchName.trim()) {
      setError('Branch name is required');
      return;
    }

    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const octokit = new Octokit({ auth: githubToken });
      
      // Parse repository URL
      const urlParts = repoUrl.replace('https://github.com/', '').split('/');
      if (urlParts.length < 2) {
        throw new Error('Invalid repository URL format');
      }
      const owner = urlParts[0];
      const repo = urlParts[1];

      // Get the default branch
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      const defaultBranch = repoData.default_branch;

      // Get the latest commit SHA from the default branch
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${defaultBranch}`,
      });
      const latestSha = refData.object.sha;

      // Create a new branch
      const sanitizedBranchName = branchName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${sanitizedBranchName}`,
        sha: latestSha,
      });

      // Create a pull request
      const { data: prData } = await octokit.pulls.create({
        owner,
        repo,
        title: `Changes from BaseBase Editor: ${branchName}`,
        head: sanitizedBranchName,
        base: defaultBranch,
        body: description,
      });

      // Success! Show the PR URL
      window.open(prData.html_url, '_blank');
      onClose();
    } catch (err) {
      console.error('Failed to create pull request:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to create pull request: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Publish Changes</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 rounded-md">
          <p className="text-sm text-blue-800">
            This will create a new branch and submit a pull request to the repository owner. 
            Your changes will be proposed for review and can be merged by the repository maintainer.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="branchName" className="block text-sm font-medium text-gray-700 mb-2">
              Branch Name
            </label>
            <input
              type="text"
              id="branchName"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g., fix-header-styling"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              What changes did you make?
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the changes you made..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md disabled:opacity-50"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating PR...' : 'Create Pull Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PublishModal; 