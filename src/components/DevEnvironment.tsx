import React, { useState, useEffect, useRef } from 'react';
import { WebContainer } from '@webcontainer/api';
import { Octokit } from '@octokit/rest';
import WebContainerManager from '../utils/webcontainer-manager';
import FileExplorer from './FileExplorer';
import CodeEditor from './CodeEditor';
import PreviewPane from './PreviewPane';

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
  const [webContainer, setWebContainer] = useState<WebContainer | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingMessage, setLoadingMessage] = useState<string>('Initializing WebContainer...');
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<WebContainer | null>(null);

  useEffect(() => {
    initializeEnvironment();
    return () => {
      // Don't teardown here since other components might be using the same instance
      // WebContainer will be cleaned up when the app unmounts
      containerRef.current = null;
    };
  }, []);

  const initializeEnvironment = async (): Promise<void> => {
    try {
      setLoadingMessage('Starting WebContainer...');
      
      const container = await WebContainerManager.getInstance();
      containerRef.current = container;
      setWebContainer(container);

      setLoadingMessage('Cloning repository...');
      await cloneRepository(container);

      setLoadingMessage('Installing dependencies...');
      await installDependencies(container);

      setLoadingMessage('Starting development server...');
      await startDevServer(container);

      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize environment');
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

    console.log('FileSystemTree structure:', JSON.stringify(fileSystemTree, null, 2));

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

  const startDevServer = async (container: WebContainer): Promise<void> => {
    // Listen for WebContainer's server-ready events
    container.on('server-ready', (port: number, url: string) => {
      console.log('WebContainer server-ready event:', { port, url });
      setServerInfo({ url, port });
    });

    // Also listen for port events
    container.on('port', (port: number, type: 'open' | 'close', url: string) => {
      console.log('WebContainer port event:', { port, type, url });
      if (type === 'open') {
        setServerInfo({ url, port });
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
            return;
          }
        }
      }
    }));
  };

  const handleFileSelect = async (file: FileNode): Promise<void> => {
    if (file.type === 'file' && webContainer) {
      try {
        const content = await webContainer.fs.readFile(file.path, 'utf-8');
        setSelectedFile({ ...file, content });
      } catch (err) {
        console.error('Failed to read file:', err);
      }
    }
  };

  const handleFileUpdate = async (path: string, content: string): Promise<void> => {
    if (webContainer) {
      try {
        await webContainer.fs.writeFile(path, content);
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
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <span>🟢 WebContainer Active</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File Explorer - 10% */}
        <div className="flex-[0_0_10%] bg-white border-r">
          <FileExplorer 
            files={fileTree} 
            onFileSelect={handleFileSelect}
            selectedFile={selectedFile}
          />
        </div>

        {/* Code Editor - 40% */}
        <div className="flex-[0_0_40%] bg-white border-r">
          <CodeEditor 
            file={selectedFile}
            onFileUpdate={handleFileUpdate}
          />
        </div>

        {/* Preview Pane - 50% */}
        <div className="flex-[0_0_50%] bg-white">
          <PreviewPane serverInfo={serverInfo} />
        </div>
      </div>
    </div>
  );
};

export default DevEnvironment; 