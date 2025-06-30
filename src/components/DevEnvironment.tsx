import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Octokit } from '@octokit/rest';
import WebContainerManager from '../utils/webcontainer-manager';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';
import PreviewPane from './PreviewPane';
import PublishModal from './PublishModal';

interface DevEnvironmentProps {
  githubToken: string | null;
  repoUrl: string;
}

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  content?: string;
}

interface ServerInfo {
  url: string;
  port: number;
}

const DevEnvironment: React.FC<DevEnvironmentProps> = ({ githubToken, repoUrl }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingMessage, setLoadingMessage] = useState<string>('Initializing WebContainer...');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState<boolean>(false);
  const [modifiedFiles, setModifiedFiles] = useState<Map<string, string>>(new Map());
  const containerRef = useRef<WebContainer | null>(null);
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    // Add reload detection
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      console.warn('Page is about to reload/unload during WebContainer initialization!');
      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    const handleUnload = () => {
      console.error('Page unloaded during WebContainer initialization!');
    };

    // Add global error handling
    const handleError = (e: ErrorEvent) => {
      console.error('Global error during WebContainer initialization:', e.error);
      console.error('Error message:', e.message);
      console.error('Error filename:', e.filename);
      console.error('Error line:', e.lineno);
    };

    const handleUnhandledRejection = (e: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection during WebContainer initialization:', e.reason);
      e.preventDefault(); // Prevent default handling that might cause reload
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    initializeEnvironment();
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      // Don't teardown here since other components might be using the same instance
      // WebContainer will be cleaned up when the app unmounts
    };
  }, []);

  const initializeEnvironment = async (): Promise<void> => {
    try {
      // Debug cross-origin isolation status
      console.log('=== Cross-Origin Isolation Status ===');
      console.log('self.crossOriginIsolated:', self.crossOriginIsolated);
      console.log('SharedArrayBuffer available:', typeof SharedArrayBuffer !== 'undefined');
      console.log('Window location:', window.location.href);
      
      if (!self.crossOriginIsolated) {
        throw new Error(
          'This application requires cross-origin isolation to function properly. ' +
          'The page appears to not be properly configured. Please contact support.'
        );
      }

      setLoadingMessage('Starting WebContainer...');
      
      // Get WebContainer instance
      const container = await WebContainerManager.getInstance();
      containerRef.current = container;

      setLoadingMessage('Cloning repository...');
      await cloneRepository(container);

      setLoadingMessage('Installing dependencies...');
      await installDependencies(container);

      setLoadingMessage('Installing Claude Code...');
      await installClaudeCode(container);

      setLoadingMessage('Starting development server...');
      await startDevServer(container);

    } catch (error: unknown) {
      console.error('Environment initialization failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      setError(`Failed to initialize environment: ${message}`);
      setIsLoading(false);
    }
  };

  const cloneRepository = async (container: WebContainer): Promise<void> => {
    if (!githubToken) {
      throw new Error('GitHub token is required');
    }

    const octokit = new Octokit({ auth: githubToken });

    // Parse repository URL to get owner and repo
    const urlParts = repoUrl.replace('https://github.com/', '').split('/');
    if (urlParts.length < 2) {
      throw new Error('Invalid repository URL format');
    }
    const owner = urlParts[0];
    const repo = urlParts[1];

    interface FileSystemTree {
      [name: string]: FileNode | DirectoryNode;
    }

    interface FileNode {
      file: {
        contents: string;
      };
    }

    interface DirectoryNode {
      directory: FileSystemTree;
    }

    const filesMap = new Map<string, string>();
    
    // Helper function to recursively get all files from a directory
    const getDirectoryContents = async (path: string = ''): Promise<void> => {
      try {
        const { data: contents } = await octokit.repos.getContent({
          owner,
          repo,
          path
        });

        if (Array.isArray(contents)) {
          for (const item of contents) {
            if (item.type === 'file' && item.download_url) {
              const response = await fetch(item.download_url);
              const content = await response.text();
              filesMap.set(item.path, content);
            } else if (item.type === 'dir') {
              // Recursively get contents of subdirectory
              await getDirectoryContents(item.path);
            }
          }
        } else if (contents.type === 'file' && contents.download_url) {
          // Single file
          const response = await fetch(contents.download_url);
          const content = await response.text();
          filesMap.set(contents.path, content);
        }
      } catch (error) {
        console.warn(`Failed to get contents for path: ${path}`, error);
      }
    };

    // Get all files recursively
    await getDirectoryContents();

    console.log('All fetched files:', Array.from(filesMap.keys()).sort());

    // Build proper FileSystemTree
    const fileSystemTree: FileSystemTree = {};
    
    for (const [path, content] of filesMap) {
      const parts = path.split('/').filter(part => part.length > 0);
      let current = fileSystemTree;
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLastPart = i === parts.length - 1;
        
        if (isLastPart) {
          // This is a file
          current[part] = {
            file: {
              contents: content
            }
          };
        } else {
          // This is a directory
          if (!current[part]) {
            current[part] = {
              directory: {}
            };
          }
          current = (current[part] as DirectoryNode).directory;
        }
      }
    }

    try {
      await container.mount(fileSystemTree);
      console.log('Successfully mounted FileSystemTree');
    } catch (mountError) {
      console.error('Failed to mount FileSystemTree:', mountError);
      throw new Error(`Mount failed: ${mountError}`);
    }
    
    // Debug: List mounted files
    console.log('Mounted files in WebContainer:', Array.from(filesMap.keys()));
    
    // Verify key files exist
    const requiredFiles = ['package.json', 'src/main.tsx', 'index.html'];
    const missingFiles = requiredFiles.filter(file => !filesMap.has(file));
    if (missingFiles.length > 0) {
      console.warn('Missing required files:', missingFiles);
    }
    
    // Note: WebContainer doesn't have git installed, so we'll use GitHub API for version control
    
    // Build file tree for UI
    const tree = buildFileTree(filesMap);
    setFileTree(tree);
  };

  const buildFileTree = (filesMap: Map<string, string>): FileNode[] => {
    const tree: FileNode[] = [];
    const nodeMap = new Map<string, FileNode>();

    // Create all nodes
    Array.from(filesMap.keys()).forEach(path => {
      const parts = path.split('/');
      let currentPath = '';
      
      parts.forEach((part, index) => {
        const previousPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        
        if (!nodeMap.has(currentPath)) {
          const isFile = index === parts.length - 1 && filesMap.has(path);
          const node: FileNode = {
            name: part,
            type: isFile ? 'file' : 'directory',
            path: currentPath,
            children: isFile ? undefined : []
          };
          nodeMap.set(currentPath, node);
          
          if (previousPath) {
            const parent = nodeMap.get(previousPath);
            if (parent && parent.children) {
              parent.children.push(node);
            }
          } else {
            tree.push(node);
          }
        }
      });
    });

    return tree;
  };

  const installDependencies = async (container: WebContainer): Promise<void> => {
    const installProcess = await container.spawn('npm', ['install']);
    const exitCode = await installProcess.exit;
    
    if (exitCode !== 0) {
      throw new Error('Failed to install dependencies');
    }
  };

  const installClaudeCode = async (container: WebContainer): Promise<void> => {
    // Clean npm cache to prevent EEXIST errors
    console.log('Cleaning npm cache to fix potential EEXIST errors...');
    const cacheCleanProcess = await container.spawn('npm', ['cache', 'clean', '--force']);
    cacheCleanProcess.output.pipeTo(new WritableStream({
        write(data) {
            console.log('npm cache clean output:', data);
        }
    }));
    const cacheCleanExitCode = await cacheCleanProcess.exit;
    if (cacheCleanExitCode !== 0) {
        console.warn(`'npm cache clean --force' exited with code ${cacheCleanExitCode}.`);
    }
    
    // Set up a directory for global npm packages to avoid permissions errors.
    console.log('Setting up npm global directory to avoid permission errors...');
    const npmGlobalPath = '/home/.npm-global';
    const setupProcess = await container.spawn('sh', [
        '-c',
        `mkdir -p ${npmGlobalPath} && npm config set prefix '${npmGlobalPath}'`
    ]);
    setupProcess.output.pipeTo(new WritableStream({
        write(data) { console.log('npm setup output:', data); }
    }));
    if ((await setupProcess.exit) !== 0) {
        throw new Error('Failed to set up npm global directory.');
    }

    // Install claude-code globally, ensuring the new global bin is in the PATH.
    console.log('Installing @anthropic-ai/claude-code globally...');
    const installCommand = `export PATH=${npmGlobalPath}/bin:$PATH && npm install -g @anthropic-ai/claude-code`;
    const installProcess = await container.spawn('sh', ['-c', installCommand]);
    const installExitCode = await installProcess.exit;
    if (installExitCode !== 0) {
      throw new Error('Failed to install @anthropic-ai/claude-code');
    }

    // Manually make the cli script executable, as npm might fail to do so.
    const chmodCliProcess = await container.spawn('sh', [
        '-c',
        `chmod +x ${npmGlobalPath}/lib/node_modules/@anthropic-ai/claude-code/cli.js`
    ]);
    if ((await chmodCliProcess.exit) !== 0) {
        throw new Error('Failed to make claude cli executable.');
    }

    // Create a wrapper script for claude since symlinks don't work in WebContainer
    console.log('Creating wrapper script for claude...');
    const wrapperScript = `#!/bin/sh\nnode ${npmGlobalPath}/lib/node_modules/@anthropic-ai/claude-code/cli.js "$@"`;
    const createWrapperProcess = await container.spawn('sh', [
        '-c',
        `rm -f ${npmGlobalPath}/bin/claude && echo '${wrapperScript}' > ${npmGlobalPath}/bin/claude-wrapper && chmod +x ${npmGlobalPath}/bin/claude-wrapper && mv ${npmGlobalPath}/bin/claude-wrapper ${npmGlobalPath}/bin/claude`
    ]);
    createWrapperProcess.output.pipeTo(new WritableStream({
        write(data) { console.log('wrapper script creation output:', data); }
    }));
    if ((await createWrapperProcess.exit) !== 0) {
        throw new Error('Failed to create claude wrapper script.');
    }

    // Create the API key helper script
    const apiKeyHelperContent = `echo "${import.meta.env.VITE_ANTHROPIC_API_KEY || ''}"`;
    const helperPath = '/home/anthropicApiKeyHelper.sh';
    
    const createScriptProcess = await container.spawn('sh', [
      '-c',
      `echo '${apiKeyHelperContent}' > ${helperPath}`
    ]);
    if ((await createScriptProcess.exit) !== 0) {
      throw new Error('Failed to create API key helper script.');
    }

    // Make the script executable
    const chmodProcess = await container.spawn('sh', ['-c', `chmod +x ${helperPath}`]);
    if ((await chmodProcess.exit) !== 0) {
      throw new Error('Failed to make API key helper executable.');
    }

    // Create the settings directory and file
    const settingsDir = '/home/.claude';
    const settingsPath = `${settingsDir}/settings.local.json`;
    
    const mkdirProcess = await container.spawn('sh', ['-c', `mkdir -p ${settingsDir}`]);
     if ((await mkdirProcess.exit) !== 0) {
      throw new Error('Failed to create .claude directory.');
    }

    const settingsContent = {
      permissions: {
        allow: [
          "Bash(find:*)",
          "Bash(ls:*)"
        ],
        deny: []
      },
      apiKeyHelper: helperPath
    };
    
    const createSettingsProcess = await container.spawn('sh', [
      '-c',
      `echo '${JSON.stringify(settingsContent)}' > ${settingsPath}`
    ]);
    if ((await createSettingsProcess.exit) !== 0) {
      throw new Error('Failed to create claude settings file.');
    }

    // Test the claude command and log output, using the correct PATH
    console.log('Testing `claude` command...');
    const testCommand = `${npmGlobalPath}/bin/claude --help > /dev/null 2>&1`;
    const claudeProcess = await container.spawn('sh', ['-c', testCommand]);

    const claudeExitCode = await claudeProcess.exit;
    if (claudeExitCode !== 0) {
      console.warn(`Claude Code installation completed but PATH resolution failed (expected in WebContainer). Claude Code is accessible via: ${npmGlobalPath}/bin/claude`);
    } else {
      console.log('✅ Claude Code installation and configuration completed successfully!');
    }
  };

  const startDevServer = async (container: WebContainer): Promise<void> => {
    // Listen for WebContainer's server-ready events
    container.on('server-ready', (port: number, url: string) => {
      console.log('WebContainer server-ready event:', { port, url });
      setServerInfo({ url, port });
      setIsLoading(false);
    });

    // Also listen for port events
    container.on('port', (port: number, type: 'open' | 'close', url: string) => {
      console.log('WebContainer port event:', { port, type, url });
      if (type === 'open') {
        setServerInfo({ url, port });
        setIsLoading(false);
      }
    });

    const devProcess = await container.spawn('npm', ['run', 'dev']);
    
    // Listen for server ready in output as backup
    devProcess.output.pipeTo(new WritableStream({
      write(data: string) {
        console.log('Dev server output:', data);
        
        // Look for various Vite output patterns
        const patterns = [
          /Local:\s+http:\/\/localhost:(\d+)/,
          /localhost:(\d+)/,
          /Local.*?:(\d+)/,
          /ready in.*localhost:(\d+)/i,
          /dev server running at.*localhost:(\d+)/i,
        ];
        
        for (const pattern of patterns) {
          const match = data.match(pattern);
          if (match) {
            const detectedPort = parseInt(match[1]);
            console.log('Server detected on port:', detectedPort);
            setServerInfo({ url: `http://localhost:${detectedPort}`, port: detectedPort });
            setIsLoading(false);
            return;
          }
        }
      }
    }));
  };

  const handleFileSelect = async (file: FileNode): Promise<void> => {
    if (file.type === 'file' && containerRef.current) {
      try {
        console.log('Reading file:', file.path);
        const content = await containerRef.current.fs.readFile(file.path, 'utf-8');
        console.log('File content loaded successfully:', file.path, content.length, 'characters');
        setSelectedFile({ ...file, content });
      } catch (err) {
        console.error('Failed to read file:', file.path, err);
        // Show an error message instead of loading forever
        const errorContent = `// Error loading file: ${file.path}\n// ${err instanceof Error ? err.message : String(err)}\n\n// Please check the browser console for more details.`;
        setSelectedFile({ ...file, content: errorContent });
      }
    } else {
      console.log('File selection skipped:', file.type, !!containerRef.current);
    }
  };

  const handleFileUpdate = async (path: string, content: string): Promise<void> => {
    if (containerRef.current) {
      try {
        await containerRef.current.fs.writeFile(path, content);
        
        // Track modified files
        setModifiedFiles(prev => new Map(prev.set(path, content)));
        console.log('📝 File modified:', path);
        
        if (selectedFile?.path === path) {
          setSelectedFile({ ...selectedFile, content });
        }
      } catch (err) {
        console.error('Failed to update file:', err);
      }
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full mx-auto flex items-center justify-center mb-6">
              <span className="text-2xl">❌</span>
            </div>
            <h2 className="text-xl font-bold text-red-600 mb-4">Error</h2>
            <p className="text-gray-700 mb-6">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full mx-4 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h2 className="text-xl font-bold mb-2">Setting up your development environment</h2>
          <p className="text-gray-600">{loadingMessage}</p>
          <div className="mt-4 text-sm text-gray-500">
            Repository: {repoUrl.replace('https://github.com/', '')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b flex items-center justify-between px-6 py-3">
        <div className="flex items-center space-x-3">
          <h1 className="text-xl font-bold text-gray-900">BaseBase Editor</h1>
          <div className="text-sm text-gray-500">
            {repoUrl.replace('https://github.com/', '')}
          </div>
        </div>
        <button
          onClick={() => setShowPublishModal(true)}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
        >
          Publish Changes
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Explorer - Fixed width */}
        <div className="w-64 flex-shrink-0 bg-white border-r">
          <FileExplorer 
            files={fileTree} 
            onFileSelect={handleFileSelect}
            selectedFile={selectedFile}
          />
        </div>

        {/* Code Editor - Fixed width */}
        <div className="w-96 flex-shrink-0 bg-white border-r">
          <CodeEditor 
            file={selectedFile}
            onFileUpdate={handleFileUpdate}
          />
        </div>

        {/* Preview Pane - Takes remaining space */}
        <div className="flex-1 bg-white">
          <PreviewPane serverInfo={serverInfo} />
        </div>
      </div>

      {/* Publish Modal */}
      {showPublishModal && (
        <PublishModal
          repoUrl={repoUrl}
          githubToken={githubToken}
          modifiedFiles={modifiedFiles}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  );
};

export default DevEnvironment; 