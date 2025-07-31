import React, { useState } from 'react';

interface FileNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileNode[];
  content?: string;
}

interface FileExplorerProps {
  files: FileNode[];
  onFileSelect: (file: FileNode) => void;
  selectedFile: FileNode | null;
}

interface FileItemProps {
  file: FileNode;
  onFileSelect: (file: FileNode) => void;
  selectedFile: FileNode | null;
  depth: number;
}

const FileItem: React.FC<FileItemProps> = ({ file, onFileSelect, selectedFile, depth }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(depth === 0);

  const handleClick = (): void => {
    if (file.type === 'directory') {
      setIsExpanded(!isExpanded);
    } else {
      onFileSelect(file);
    }
  };

  const getFileIcon = (fileName: string, type: 'file' | 'directory'): string => {
    if (type === 'directory') {
      return isExpanded ? '📂' : '📁';
    }
    
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return '🔷';
      case 'js':
      case 'jsx':
        return '🟨';
      case 'json':
        return '📋';
      case 'css':
        return '🎨';
      case 'html':
        return '🌐';
      case 'md':
        return '📝';
      default:
        return '📄';
    }
  };

  const isSelected = selectedFile?.path === file.path;

  return (
    <>
      <div
        onClick={handleClick}
        className={`flex items-center px-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
          isSelected ? 'bg-blue-100 dark:bg-brand-900/30 text-blue-700 dark:text-brand-300' : 'text-gray-900 dark:text-gray-100'
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {file.type === 'directory' && (
          <span className="mr-1 text-xs text-gray-500 dark:text-gray-400">
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        <span className="mr-2">{getFileIcon(file.name, file.type)}</span>
        <span className="text-sm truncate">{file.name}</span>
      </div>
      
      {file.type === 'directory' && isExpanded && file.children && (
        <>
          {file.children.map((child) => (
            <FileItem
              key={child.path}
              file={child}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  );
};

const FileExplorer: React.FC<FileExplorerProps> = ({ files, onFileSelect, selectedFile }) => {
  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 transition-colors">
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 border-b dark:border-gray-700 transition-colors">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors">Files</h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.map((file) => (
          <FileItem
            key={file.path}
            file={file}
            onFileSelect={onFileSelect}
            selectedFile={selectedFile}
            depth={0}
          />
        ))}
      </div>
    </div>
  );
};

export default FileExplorer; 