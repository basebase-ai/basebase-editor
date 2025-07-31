import React, { useState } from 'react';
import { Octokit } from '@octokit/rest';

interface PublishModalProps {
  repoUrl: string;
  githubToken: string | null;
  modifiedFiles: Map<string, string>;
  onClose: () => void;
}

const PublishModal: React.FC<PublishModalProps> = ({ repoUrl, githubToken, modifiedFiles, onClose }) => {
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
      // Parse repository URL
      const urlParts = repoUrl.replace('https://github.com/', '').split('/');
      if (urlParts.length < 2) {
        throw new Error('Invalid repository URL format');
      }
      const owner = urlParts[0];
      const repo = urlParts[1];
      const sanitizedBranchName = branchName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

      console.log('📝 Modified files to commit:', Array.from(modifiedFiles.keys()));

      if (modifiedFiles.size === 0) {
        throw new Error('No files have been modified. Make some changes before publishing.');
      }

      const octokit = new Octokit({ auth: githubToken });

      // Get repository info and default branch
      console.log('🔍 Getting repository info...');
      const { data: repoData } = await octokit.repos.get({ owner, repo });
      const defaultBranch = repoData.default_branch;
      console.log('Default branch:', defaultBranch);

      // Get the latest commit SHA
      const { data: refData } = await octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${defaultBranch}`,
      });
      const latestSha = refData.object.sha;
      console.log('Latest commit SHA:', latestSha);

      // Create new branch
      console.log('🌿 Creating branch:', sanitizedBranchName);
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${sanitizedBranchName}`,
        sha: latestSha,
      });

      // Create blobs for modified files and build tree
      const treeItems = [];
      console.log('📄 Creating blobs for modified files...');
      
      for (const [filePath, content] of modifiedFiles) {
        console.log('Creating blob for:', filePath);
        const { data: blobData } = await octokit.git.createBlob({
          owner,
          repo,
          content,
          encoding: 'utf-8',
        });
        
        treeItems.push({
          path: filePath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobData.sha,
        });
      }

      // Create new tree
      console.log('🌳 Creating new tree...');
      const { data: treeData } = await octokit.git.createTree({
        owner,
        repo,
        base_tree: latestSha,
        tree: treeItems,
      });

      // Create commit
      const commitMessage = `Changes from BaseBase Editor: ${branchName}\n\n${description}`;
      console.log('💾 Creating commit...');
      const { data: commitData } = await octokit.git.createCommit({
        owner,
        repo,
        message: commitMessage,
        tree: treeData.sha,
        parents: [latestSha],
      });

      // Update branch reference
      console.log('🔗 Updating branch reference...');
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${sanitizedBranchName}`,
        sha: commitData.sha,
      });

      // Create pull request
      console.log('🚀 Creating pull request...');
      const { data: prData } = await octokit.pulls.create({
        owner,
        repo,
        title: `Changes from BaseBase Editor: ${branchName}`,
        head: sanitizedBranchName,
        base: defaultBranch,
        body: description,
      });

      console.log('✅ Pull request created successfully:', prData.html_url);

      // Success! Show the PR URL
      window.open(prData.html_url, '_blank');
      onClose();
    } catch (err) {
      console.error('❌ Failed to create pull request:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Failed to create pull request: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center z-50 transition-colors">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md mx-4 transition-colors">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white transition-colors">Publish Changes</h2>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md transition-colors">
          <p className="text-sm text-blue-800 dark:text-blue-300 transition-colors">
            This will create a new branch and submit a pull request to the repository owner. 
            Your changes will be proposed for review and can be merged by the repository maintainer.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="branchName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 transition-colors">
              Branch Name
            </label>
            <input
              type="text"
              id="branchName"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g., fix-header-styling"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 dark:focus:ring-brand-400 transition-colors"
              disabled={isSubmitting}
            />
          </div>

          <div className="mb-4">
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 transition-colors">
              What changes did you make?
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the changes you made..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600 dark:focus:ring-brand-400 transition-colors"
              disabled={isSubmitting}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md transition-colors">
              <p className="text-sm text-red-800 dark:text-red-300 transition-colors">{error}</p>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-md disabled:opacity-50 transition-colors"
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