import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import WebContainerManager from '../utils/webcontainer-manager';
import type { WebContainer } from '@webcontainer/api';

// Define types locally since we're no longer importing from SDKs
interface ContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  name?: string;
  input?: unknown;
  id?: string;
}

interface MessageParam {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content: ContentBlock[];
}

type ApiProvider = 'anthropic' | 'google';

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

interface AiChatPanelProps {
  webcontainer: WebContainer | null;
}

const AiChatPanel: React.FC<AiChatPanelProps> = ({ webcontainer }) => {
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: 'initial-message',
      role: 'assistant',
      content: [{ type: 'text', text: 'How would you like to improve this app?' }] as ContentBlock[],
    }
  ]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [apiProvider, setApiProvider] = useState<ApiProvider>('google');
  const [apiStatus, setApiStatus] = useState<{ anthropic: boolean; google: boolean }>({ anthropic: false, google: false });
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Check API availability on mount
  useEffect(() => {
    const checkApiStatus = async (): Promise<void> => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          const status = await response.json();
          setApiStatus({ anthropic: status.anthropic, google: status.google });
        }
      } catch (error) {
        console.error('Failed to check API status:', error);
      }
    };
    checkApiStatus();
  }, []);

  const scrollToBottom = (): void => {
    // Use setTimeout to ensure DOM has been updated
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]); // Also scroll when loading state changes

  // Additional effect to scroll when new content is added (like during streaming responses)
  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 200);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const getSystemPrompt = async (): Promise<string> => {
    const files = await WebContainerManager.listFiles('*', '.', true);
    const repoStructure = files.join('\n');
    const currentErrors = ''; // Placeholder
    const recentFiles = ''; // Placeholder

    return `You are a coding assistant working on a web app project. You have access to tools to read, write, and analyze files.

CRITICAL: All your tools (read_file, write_file, list_files, grep_search, run_command) operate on the USER'S PROJECT FILES that have been cloned from GitHub into a WebContainer environment. You are NOT working on the editor application itself - you are working on the actual project files that the user wants to modify.

CURRENT PROJECT CONTEXT:
- Repository structure:
${repoStructure}
- Current errors: ${currentErrors}
- Recently modified: ${recentFiles}

WORKFLOW:
1. Use list_files to see what files are available in the user's project, or use grep_search to find specific text patterns across the user's project files (this is crucial for finding where text appears in their codebase)
2. Use read_file to examine specific files in the user's project
3. Make targeted changes with write_file to modify the user's project files
4. Verify changes with run_command (lint/test) within the user's project

IMPORTANT: When asked to find or change specific text like "Sign In" buttons, UI components, etc., ALWAYS use grep_search first to locate where that text appears in the USER'S PROJECT FILES. The text you're looking for exists in the cloned repository, not in the editor's source code.

Always read files before modifying them. When making changes, explain your reasoning and check for errors afterward. Please be as concise as possible, summarizing your ideas, your approach, and your completed work in a few lines at a time.`;
  };
  
  const stopGeneration = (): void => {
    if (abortControllerRef.current) {
      console.log('🛑 [AI] Stopping generation...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);
      setLoadingMessage('');
      
      // Add a system message to indicate generation was stopped
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: [{ type: 'text', text: '🛑 Generation stopped by user.' }] as ContentBlock[],
        },
      ]);
    }
  };

  const sendMessage = async (): Promise<void> => {
    if (!input.trim() || !webcontainer) return;

    const userMessageContent = input.trim();
    console.log(`🤖 [AI] User: "${userMessageContent}"`);
    
    const newUiMessages: UiMessage[] = [
      ...messages,
      {
        id: Date.now().toString(),
        role: 'user',
        content: [{ type: 'text', text: userMessageContent }] as ContentBlock[],
      },
    ];
    setMessages(newUiMessages);

    const apiMessages: MessageParam[] = newUiMessages.map(
        (msg): MessageParam => ({
            role: msg.role,
            content: msg.content.map(c => ('text' in c ? c.text : '')).join(''),
        })
    );

    setInput('');
    setIsLoading(true);
    setLoadingMessage('Thinking...');

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();

    console.log(`🤖 [AI] Sending request to ${apiProvider}...`);

    try {
      if (apiProvider === 'anthropic') {
        await sendAnthropicMessage(apiMessages);
      } else {
        await sendGoogleMessage(apiMessages);
      }
    } catch (error: unknown) {
      console.error(`🤖 [AI] Error:`, error);
      // Check if the error is due to abortion
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🛑 [AI] Request was aborted');
        return; // Don't show error message for user-initiated stops
      }
      // Handle other errors
      setMessages(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}` }] as ContentBlock[],
        },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      abortControllerRef.current = null;
      console.log(`🤖 [AI] Request completed`);
    }
  };

  const sendAnthropicMessage = async (apiMessages: MessageParam[]) => {
    const systemPrompt = await getSystemPrompt();
    
    const requestBody = {
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      tools: [
        {
          name: 'read_file',
          description: 'Read the contents of a file in the user\'s project (WebContainer)',
          input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
        {
          name: 'write_file',
          description: 'Write/update a file in the user\'s project (WebContainer)',
          input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        },
        {
          name: 'list_files',
          description: 'List files in the user\'s project directory (WebContainer) with glob patterns',
          input_schema: { type: 'object', properties: { pattern: { type: 'string' }, include_hidden: { type: 'boolean' } }, required: ['pattern'] },
        },
        {
          name: 'grep_search',
          description: 'Search for text patterns across all files in the user\'s project repository (WebContainer)',
          input_schema: { 
            type: 'object', 
            properties: { 
              pattern: { type: 'string', description: 'The text pattern to search for in the user\'s project files' },
              case_sensitive: { type: 'boolean', description: 'Whether the search should be case sensitive (default: false)' },
              whole_words: { type: 'boolean', description: 'Whether to match whole words only (default: false)' },
              file_pattern: { type: 'string', description: 'File pattern to limit search scope (e.g., "*.js", "*.tsx")' },
              max_results: { type: 'number', description: 'Maximum number of results to return (default: 100)' }
            }, 
            required: ['pattern'] 
          },
        },
        {
          name: 'run_command',
          description: 'Execute commands (lint, test, build) in the user\'s project (WebContainer)',
          input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] },
        },
      ],
    };

    const response = await fetch('/api/anthropic/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortControllerRef.current?.signal,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to call Anthropic API');
    }

    const res = await response.json();

    let apiResponse = res;
    const newApiMessages: MessageParam[] = [...apiMessages, { role: apiResponse.role, content: apiResponse.content }];

    while (apiResponse.stop_reason === 'tool_use') {
      // Check if aborted
      if (abortControllerRef.current?.signal.aborted) {
        throw new Error('AbortError');
      }
      
      // Extract any text content before tool use and display it
      const textContent = apiResponse.content.filter((c: ContentBlock) => c.type === 'text' && c.text?.trim()).map((c: ContentBlock) => c.text).join('');
      if (textContent.trim()) {
        setMessages(prev => [
          ...prev,
          {
            id: `intermediate-${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'text', text: textContent }] as ContentBlock[],
          },
        ]);
      }
      
      const toolUses = apiResponse.content.filter((c: ContentBlock): c is ContentBlock & { type: 'tool_use'; name: string; input: unknown; id: string } => c.type === 'tool_use');
      console.log(`🔧 [Tools] Claude wants to use: ${toolUses.map((t: { name: string }) => t.name).join(', ')}`);
      
      // Check for repeated read_file operations on the same file
      const currentReads = toolUses.filter((tool: { name: string }) => tool.name === 'read_file');
      for (const readTool of currentReads) {
        const readInput = readTool.input as Record<string, unknown>;
        const filePath = readInput.path as string;
        if (filePath && messages.some(msg => 
          msg.role === 'assistant' && 
          msg.content.some(content => 
            content.type === 'text' && 
            content.text?.includes(`🔧 Read ${filePath}`)
          )
        )) {
          console.log(`🛑 [Tools] Preventing repeated read of ${filePath}`);
          setMessages(prev => [
            ...prev,
            {
              id: `prevent-repeat-${Date.now()}`,
              role: 'assistant',
              content: [{ type: 'text', text: `I already read ${filePath}. Let me use that information to proceed.` }] as ContentBlock[],
            },
          ]);
          return; // Exit the tool calling loop
        }
      }

      const toolResults = await Promise.all(
        toolUses.map(async (toolUse: { id: string; name: string; input: unknown }): Promise<ToolResultBlockParam> => {
          const { name, input } = toolUse;
          let toolOutput: string | undefined;
          let toolStatusMessage = '';
          const toolInput = input as Record<string, unknown>;

          // Update loading message based on tool being used
          if (name === 'read_file') {
            setLoadingMessage('Reading file...');
          } else if (name === 'write_file') {
            setLoadingMessage('Writing file...');
          } else if (name === 'list_files') {
            setLoadingMessage('Listing files...');
          } else if (name === 'grep_search') {
            setLoadingMessage('Searching files...');
          } else if (name === 'run_command') {
            setLoadingMessage('Running command...');
          }

                    try {
            // Check if aborted before each tool execution
            if (abortControllerRef.current?.signal.aborted) {
              throw new Error('AbortError');
            }
            
            if (name === 'read_file' && typeof toolInput.path === 'string') {
              toolOutput = await WebContainerManager.readFile(toolInput.path);
              const lines = toolOutput.split('\n').length;
              toolStatusMessage = `Read ${toolInput.path} (${lines} lines)`;
              console.log(`🔧 [Tools] Read file: ${toolInput.path}`);
            } else if (name === 'write_file' && typeof toolInput.path === 'string' && typeof toolInput.content === 'string') {
              await WebContainerManager.writeFile(toolInput.path, toolInput.content);
              toolOutput = `File ${toolInput.path} written successfully.`;
              toolStatusMessage = `Edited ${toolInput.path}`;
              console.log(`🔧 [Tools] Wrote file: ${toolInput.path}`);
            } else if (name === 'list_files' && typeof toolInput.pattern === 'string') {
              const includeHidden = typeof toolInput.include_hidden === 'boolean' ? toolInput.include_hidden : false;
              const files = await WebContainerManager.listFiles(toolInput.pattern, '.', includeHidden);
              toolOutput = files.join('\n');
              // Count non-empty lines for accurate file count
              const fileCount = files.filter(f => f.trim().length > 0).length;
              toolStatusMessage = `Listed files (${fileCount} results)`;
              console.log(`🔧 [Tools] Listed ${fileCount} files`);
            } else if (name === 'grep_search' && typeof toolInput.pattern === 'string') {
              const options = {
                caseSensitive: typeof toolInput.case_sensitive === 'boolean' ? toolInput.case_sensitive : false,
                wholeWords: typeof toolInput.whole_words === 'boolean' ? toolInput.whole_words : false,
                filePattern: typeof toolInput.file_pattern === 'string' ? toolInput.file_pattern : "**/*",
                maxResults: typeof toolInput.max_results === 'number' ? toolInput.max_results : 100,
              };
              toolOutput = await WebContainerManager.grepSearch(toolInput.pattern, options);
              const validLines = toolOutput.split('\n').filter(line => line.trim() && line.includes(':'));
              const matches = validLines.length;
              const uniqueFiles = new Set(validLines.map(line => line.split(':')[0]).filter(f => f.trim())).size;
              toolStatusMessage = `Found ${matches} matches in ${uniqueFiles} files for "${toolInput.pattern}"`;
              console.log(`🔧 [Tools] Searched for: "${toolInput.pattern}"`);
            } else if (name === 'run_command' && typeof toolInput.command === 'string' && Array.isArray(toolInput.args)) {
              toolOutput = await WebContainerManager.runCommand(toolInput.command, toolInput.args as string[]);
              const lines = toolOutput.split('\n');
              const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';
              const exitCodeMatch = lastLine.match(/exit code[:\s]+(\d+)/i);
              const exitCode = exitCodeMatch ? ` (exit code ${exitCodeMatch[1]})` : '';
              toolStatusMessage = `Ran ${toolInput.command}${exitCode}`;
              console.log(`🔧 [Tools] Ran command: ${toolInput.command}`);
            } else {
              toolOutput = `Unknown tool or invalid arguments: ${name}`;
              toolStatusMessage = `Error: ${name}`;
            }

            // Add tool status message to chat
            if (toolStatusMessage) {
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
            }
          } catch (e: unknown) {
              const error = e as Error;
              toolOutput = `Error executing tool ${name}: ${error.message}`;
              console.error(`🔧 [Tools] Error with ${name}:`, error.message);
          }

          const result: ToolResultBlockParam = {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [{ type: 'text', text: toolOutput ?? 'Tool executed with no output.' }],
          };
          
          // Debug: Log what we're sending back to the AI
          console.log(`🔧 [Tools] Sending result to AI for ${name}:`, {
            tool: name,
            outputLength: toolOutput?.length || 0,
            outputPreview: toolOutput?.substring(0, 100) + (toolOutput && toolOutput.length > 100 ? '...' : ''),
          });
          
          return result;
        })
      );
      
      newApiMessages.push({ role: 'user', content: toolResults });
      
      // Debug: Log the conversation state
      console.log(`🔧 [Tools] Total tool results sent to Claude:`, toolResults.length);
      console.log(`🔧 [Tools] Message history length:`, newApiMessages.length);

      setLoadingMessage('Thinking...');
      console.log(`🔧 [Tools] Sending results back to Claude...`);
      
      const followUpRequestBody = {
        model: 'claude-3-opus-20240229',
        max_tokens: 4096,
        system: systemPrompt,
        messages: newApiMessages,
        tools: [
          { name: 'read_file', description: 'Read the contents of a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
          { name: 'write_file', description: 'Write/update a file', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
          { name: 'list_files', description: 'List files in directory (with glob patterns)', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, include_hidden: { type: 'boolean' } }, required: ['pattern'] } },
          { name: 'grep_search', description: 'Search for text patterns across all files in the repository', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, case_sensitive: { type: 'boolean' }, whole_words: { type: 'boolean' }, file_pattern: { type: 'string' }, max_results: { type: 'number' } }, required: ['pattern'] } },
          { name: 'run_command', description: 'Execute commands (lint, test, build)', input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] } },
        ],
      };

      const followUpResponse = await fetch('/api/anthropic/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(followUpRequestBody),
        signal: abortControllerRef.current?.signal,
      });

      if (!followUpResponse.ok) {
        const error = await followUpResponse.json();
        throw new Error(error.message || 'Failed to call Anthropic API');
      }

      apiResponse = await followUpResponse.json();
      
      newApiMessages.push({role: apiResponse.role, content: apiResponse.content });
    }

    console.log(`🤖 [AI] Claude finished with response`);
    setMessages(prev => [
      ...prev,
      { id: apiResponse.id, role: 'assistant', content: apiResponse.content },
    ]);
  }

  const sendGoogleMessage = async (apiMessages: MessageParam[]) => {
    if (!apiStatus.google) {
      console.error('🤖 [AI] Google API not available - missing API key');
      return;
    }

    const systemPrompt = await getSystemPrompt();
    
    // Define function declarations for Gemini (Type is no longer imported, use strings)
    const readFileDeclaration = {
      name: 'read_file',
      description: 'Read the contents of a file in the user\'s project (WebContainer)',
      parameters: {
        type: 'OBJECT',
        properties: {
          path: {
            type: 'STRING',
            description: 'Path to the file to read in the user\'s project'
          }
        },
        required: ['path']
      }
    };

    const writeFileDeclaration = {
      name: 'write_file',
      description: 'Write/update a file in the user\'s project (WebContainer)',
      parameters: {
        type: 'OBJECT',
        properties: {
          path: {
            type: 'STRING',
            description: 'Path to the file to write in the user\'s project'
          },
          content: {
            type: 'STRING',
            description: 'Content to write to the file in the user\'s project'
          }
        },
        required: ['path', 'content']
      }
    };

    const listFilesDeclaration = {
      name: 'list_files',
      description: 'List files in the user\'s project directory (WebContainer) with glob patterns',
      parameters: {
        type: 'OBJECT',
        properties: {
          pattern: {
            type: 'STRING',
            description: 'Glob pattern to match files in the user\'s project (e.g., "*.js", "**/*.tsx")'
          },
          include_hidden: {
            type: 'BOOLEAN',
            description: 'Whether to include hidden files (default: false)'
          }
        },
        required: ['pattern']
      }
    };

    const grepSearchDeclaration = {
      name: 'grep_search',
      description: 'Search for text patterns across all files in the user\'s project repository (WebContainer). Use this to find where specific text appears in the user\'s project before making changes.',
      parameters: {
        type: 'OBJECT',
        properties: {
          pattern: {
            type: 'STRING',
            description: 'The exact text pattern to search for in the user\'s project files (e.g., "Sign In", "button", "function")'
          },
          case_sensitive: {
            type: 'BOOLEAN',
            description: 'Whether the search should be case sensitive (default: false)'
          },
          whole_words: {
            type: 'BOOLEAN',
            description: 'Whether to match whole words only (default: false)'
          },
          file_pattern: {
            type: 'STRING',
            description: 'File pattern to limit search scope (e.g., "*.js", "*.tsx", "*.html")'
          },
          max_results: {
            type: 'NUMBER',
            description: 'Maximum number of results to return (default: 100)'
          }
        },
        required: ['pattern']
      }
    };

    const runCommandDeclaration = {
      name: 'run_command',
      description: 'Execute commands (lint, test, build) in the user\'s project (WebContainer)',
      parameters: {
        type: 'OBJECT',
        properties: {
          command: {
            type: 'STRING',
            description: 'Command to execute in the user\'s project'
          },
          args: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Arguments for the command'
          }
        },
        required: ['command', 'args']
      }
    };

    const functionDeclarations = [readFileDeclaration, writeFileDeclaration, listFilesDeclaration, grepSearchDeclaration, runCommandDeclaration];

    // Build the conversation history for Gemini
    const conversationHistory = apiMessages.map(msg => {
      const content = Array.isArray(msg.content) 
        ? msg.content.map(c => 'text' in c ? c.text : '').join('') 
        : msg.content as string;
      return `${msg.role}: ${content}`;
    }).join('\n\n');

    const fullPrompt = `${systemPrompt}\n\nConversation so far:\n${conversationHistory}`;

    // Debug: Log conversation history and extract user intent
    console.log(`🤖 [DEBUG] Conversation history being sent to Gemini:`, conversationHistory);
    console.log(`🤖 [DEBUG] Full prompt length:`, fullPrompt.length);
    
    // Extract the user's last request for context tracking
    const lastUserMessage = apiMessages.filter(msg => msg.role === 'user').pop();
    const userRequest = Array.isArray(lastUserMessage?.content) 
      ? lastUserMessage?.content.map(c => 'text' in c ? c.text : '').join('') 
      : lastUserMessage?.content as string || '';
    console.log(`🤖 [DEBUG] User's current request:`, userRequest);

    try {
      console.log('🤖 [DEBUG] Starting Google GenAI request...');
      
      const requestBody = {
        model: "gemini-2.0-flash",
        contents: fullPrompt,
        config: {
          tools: [{
            functionDeclarations: functionDeclarations
          }]
        }
      };

      const apiResponse = await fetch('/api/google/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current?.signal,
      });

      if (!apiResponse.ok) {
        const error = await apiResponse.json();
        throw new Error(error.message || 'Failed to call Google GenAI API');
      }

      let response = await apiResponse.json();

      console.log('🤖 [DEBUG] Got response from Google GenAI:', response);
      console.log('🤖 [DEBUG] Response type:', typeof response);
      console.log('🤖 [DEBUG] Response keys:', Object.keys(response));

      // Handle function calls in a loop similar to Anthropic
      let responseText = '';
      const toolResults: string[] = [];
      let functionCalls: Array<{ name?: string; args?: Record<string, unknown> }> = [];
      let iterationCount = 0;
      const maxIterations = 10; // Increased to allow more complex tasks

      // Extract text and function calls from response
      try {
        console.log('🤖 [DEBUG] Attempting to extract response data...');
        console.log('🤖 [DEBUG] Response candidates:', response.candidates);
        
        // Extract text from candidates
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          console.log('🤖 [DEBUG] First candidate:', candidate);
          
          if (candidate.content && candidate.content.parts) {
            console.log('🤖 [DEBUG] Candidate parts:', candidate.content.parts);
            
            // Extract text parts
            const textParts = candidate.content.parts
              .filter((part: { text?: string }) => part.text)
              .map((part: { text?: string }) => part.text || '');
            responseText = textParts.join('');
            console.log('🤖 [DEBUG] Extracted text:', responseText);
            console.log('🤖 [DEBUG] Text parts count:', textParts.length);
            console.log('🤖 [DEBUG] Individual text parts:', textParts);
            
            // Extract function call parts
            const functionCallParts = candidate.content.parts
              .filter((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => part.functionCall);
            functionCalls = functionCallParts.map((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => ({
              name: part.functionCall?.name || '',
              args: part.functionCall?.args || {}
            }));
            console.log('🤖 [DEBUG] Extracted function calls:', functionCalls);
            console.log('🤖 [DEBUG] Function call parts count:', functionCallParts.length);
            console.log('🤖 [DEBUG] Raw function call parts:', functionCallParts);
          }
        }
        
        console.log('🤖 [DEBUG] Function calls length:', functionCalls.length);
      } catch (error) {
        console.error('🤖 [DEBUG] Error extracting response data:', error);
      }

      while (functionCalls.length > 0 && iterationCount < maxIterations) {
        // Check if aborted
        if (abortControllerRef.current?.signal.aborted) {
          throw new Error('AbortError');
        }
        
        iterationCount++;
        console.log(`🤖 [DEBUG] Starting iteration ${iterationCount}/${maxIterations}`);
        console.log(`🔧 [Tools] Gemini wants to use: ${functionCalls.map((fc: { name?: string }) => fc.name || 'unknown').join(', ')}`);
        
        // Show any text response before tool calls
        if (responseText.trim() && iterationCount === 1) {
          setMessages(prev => [
            ...prev,
            {
              id: `intermediate-${Date.now()}`,
              role: 'assistant',
              content: [{ type: 'text', text: responseText }] as ContentBlock[],
            },
          ]);
        }
        
        // Clear functionCalls to prevent infinite loop
        const currentFunctionCalls = [...functionCalls];
        functionCalls = [];
        console.log(`🤖 [DEBUG] Cleared functionCalls array, processing ${currentFunctionCalls.length} calls`);
        
        // Improved loop detection and prevention
        const currentActions = currentFunctionCalls.map(fc => `${fc.name}:${JSON.stringify(fc.args)}`);
        const recentActionNames = toolResults.slice(-5).map(result => {
          const match = result.match(/^Function (\w+) result:/);
          return match ? match[1] : '';
        });
        
        console.log(`🤖 [DEBUG] Current actions:`, currentActions);
        console.log(`🤖 [DEBUG] Recent action names:`, recentActionNames);
        
        // More aggressive loop detection for any repeated action on the same target
        for (const currentAction of currentActions) {
          const [actionName] = currentAction.split(':', 2);
          
          // Check if this exact action was already performed recently
          if (toolResults.slice(-3).some(result => result.includes(`Function ${actionName} result:`))) {
            console.log(`🤖 [DEBUG] Detected repeated ${actionName} action, checking for completion`);
            
            // If we have recent write actions, the task is likely complete
            if (actionName === 'write_file' || recentActionNames.includes('write_file')) {
              console.log(`🤖 [DEBUG] Task appears complete - breaking loop to prevent repetition`);
              responseText += '\n\n✅ Task completed successfully.';
              functionCalls = []; // Clear function calls to exit the while loop
              break; // Exit the for loop
            }
            
            // If we're just reading/searching repeatedly without writes, also break
            if ((actionName === 'read_file' || actionName === 'grep_search') && 
                recentActionNames.filter(name => name === actionName).length >= 2) {
              console.log(`🤖 [DEBUG] Excessive ${actionName} repetition detected - breaking loop`);
              responseText += '\n\n✅ Information gathering completed.';
              functionCalls = []; // Clear function calls to exit the while loop
              break; // Exit the for loop
            }
          }
        }
        
        // Check if loop should exit after repetition detection
        if (functionCalls.length === 0) {
          console.log(`🤖 [DEBUG] Function calls cleared by repetition detection - exiting loop`);
          break;
        }
        
        for (const functionCall of currentFunctionCalls) {
          const { name, args } = functionCall;
          let toolOutput: string | undefined;

          // Update loading message based on tool being used
          if (name === 'read_file') {
            setLoadingMessage('Reading file...');
          } else if (name === 'write_file') {
            setLoadingMessage('Writing file...');
          } else if (name === 'list_files') {
            setLoadingMessage('Listing files...');
          } else if (name === 'grep_search') {
            setLoadingMessage('Searching files...');
          } else if (name === 'run_command') {
            setLoadingMessage('Running command...');
          }

          try {
            // Check if aborted before each tool execution
            if (abortControllerRef.current?.signal.aborted) {
              throw new Error('AbortError');
            }
            
            if (name === 'read_file' && typeof args?.path === 'string') {
              toolOutput = await WebContainerManager.readFile(args.path);
              const lines = toolOutput.split('\n').length;
              const toolStatusMessage = `Read ${args.path} (${lines} lines)`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
              console.log(`🔧 [Tools] Read file: ${args.path}`);
            } else if (name === 'write_file' && typeof args?.path === 'string' && typeof args?.content === 'string') {
              await WebContainerManager.writeFile(args.path, args.content);
              toolOutput = `File ${args.path} written successfully.`;
              const toolStatusMessage = `Edited ${args.path}`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
              console.log(`🔧 [Tools] Wrote file: ${args.path}`);
            } else if (name === 'list_files' && typeof args?.pattern === 'string') {
              const includeHidden = typeof args?.include_hidden === 'boolean' ? args.include_hidden : false;
              const files = await WebContainerManager.listFiles(args.pattern, '.', includeHidden);
              toolOutput = files.join('\n');
              // Count non-empty lines for accurate file count
              const fileCount = files.filter(f => f.trim().length > 0).length;
              const toolStatusMessage = `Listed files (${fileCount} results)`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
              console.log(`🔧 [Tools] Listed ${fileCount} files`);
            } else if (name === 'grep_search' && typeof args?.pattern === 'string') {
              const options = {
                caseSensitive: typeof args?.case_sensitive === 'boolean' ? args.case_sensitive : false,
                wholeWords: typeof args?.whole_words === 'boolean' ? args.whole_words : false,
                filePattern: typeof args?.file_pattern === 'string' ? args.file_pattern : "**/*",
                maxResults: typeof args?.max_results === 'number' ? args.max_results : 100,
              };
              toolOutput = await WebContainerManager.grepSearch(args.pattern, options);
              const validLines = toolOutput.split('\n').filter(line => line.trim() && line.includes(':'));
              const matches = validLines.length;
              const uniqueFiles = new Set(validLines.map(line => line.split(':')[0]).filter(f => f.trim())).size;
              const toolStatusMessage = `Found ${matches} matches in ${uniqueFiles} files for "${args.pattern}"`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
              console.log(`🔧 [Tools] Searched for: "${args.pattern}"`);
            } else if (name === 'run_command' && typeof args?.command === 'string' && Array.isArray(args?.args)) {
              toolOutput = await WebContainerManager.runCommand(args.command, args.args as string[]);
              const lines = toolOutput.split('\n');
              const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';
              const exitCodeMatch = lastLine.match(/exit code[:\s]+(\d+)/i);
              const exitCode = exitCodeMatch ? ` (exit code ${exitCodeMatch[1]})` : '';
              const toolStatusMessage = `Ran ${args.command}${exitCode}`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
              console.log(`🔧 [Tools] Ran command: ${args.command}`);
            } else {
              toolOutput = `Unknown tool or invalid arguments: ${name}`;
              const toolStatusMessage = `Error: ${name}`;
              setMessages(prev => [
                ...prev,
                {
                  id: `tool-${Date.now()}-${Math.random()}`,
                  role: 'assistant',
                  content: [{ type: 'text', text: `🔧 ${toolStatusMessage}` }] as ContentBlock[],
                },
              ]);
            }
          } catch (e: unknown) {
            const error = e as Error;
            toolOutput = `Error executing tool ${name}: ${error.message}`;
            console.error(`🔧 [Tools] Error with ${name}:`, error.message);
          }

          const result = `Function ${name} result:\n${toolOutput ?? 'Tool executed with no output.'}`;
          toolResults.push(result);
          
          // Debug: Log what we're sending back to Gemini
          console.log(`🔧 [Tools] Sending result to Gemini for ${name}:`, {
            tool: name,
            outputLength: toolOutput?.length || 0,
            outputPreview: toolOutput?.substring(0, 100) + (toolOutput && toolOutput.length > 100 ? '...' : ''),
          });
          console.log(`🤖 [DEBUG] Formatted result for ${name}:`, result);
          console.log(`🤖 [DEBUG] Raw tool output for ${name}:`, toolOutput);
        }

        // Send tool results back to Gemini
        setLoadingMessage('Thinking...');
        console.log(`🔧 [Tools] Sending results back to Gemini...`);
        console.log(`🤖 [DEBUG] Tool results count: ${toolResults.length}`);
        
        // Debug: Log each tool result in detail
        console.log(`🤖 [DEBUG] All tool results being sent to Gemini:`);
        toolResults.forEach((result, index) => {
          console.log(`🤖 [DEBUG] Tool Result ${index + 1}:`, result);
          console.log(`🤖 [DEBUG] Tool Result ${index + 1} length:`, result.length);
        });
        
        // Create a more structured prompt that preserves context better
        const toolResultsSection = toolResults.map((result, index) => {
          return `--- Tool Result ${index + 1} ---\n${result}`;
        }).join('\n\n');
        
        const toolResultsPrompt = `${fullPrompt}\n\n=== TOOL EXECUTION RESULTS ===\n${toolResultsSection}\n\n=== INSTRUCTIONS ===\nBased on the tool results above, provide a final response to the user. Do NOT call more tools unless absolutely necessary. If the task is complete, provide a summary of what was accomplished.`;
        
        console.log(`🤖 [DEBUG] Tool results prompt length:`, toolResultsPrompt.length);
        console.log(`🤖 [DEBUG] Last 3 tool results:`, toolResults.slice(-3));
        console.log(`🤖 [DEBUG] Full prompt being sent to Gemini:`, toolResultsPrompt.substring(0, 1000) + '...');
        
        console.log('🤖 [DEBUG] Making follow-up request to Google GenAI...');
        
        const followUpRequestBody = {
          model: "gemini-2.0-flash",
          contents: toolResultsPrompt,
          config: {
            tools: [{
              functionDeclarations: functionDeclarations
            }]
          }
        };

        const followUpApiResponse = await fetch('/api/google/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(followUpRequestBody),
          signal: abortControllerRef.current?.signal,
        });

        if (!followUpApiResponse.ok) {
          const error = await followUpApiResponse.json();
          throw new Error(error.message || 'Failed to call Google GenAI API');
        }

        response = await followUpApiResponse.json();

        console.log('🤖 [DEBUG] Got follow-up response:', response);
        console.log('🤖 [DEBUG] Follow-up response keys:', Object.keys(response));

        try {
          console.log('🤖 [DEBUG] Attempting to extract follow-up response data...');
          
          // Extract text and function calls from follow-up response
          if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            console.log('🤖 [DEBUG] Follow-up candidate:', candidate);
            console.log('🤖 [DEBUG] Follow-up finish reason:', candidate.finishReason);
            
            if (candidate.content && candidate.content.parts) {
              console.log('🤖 [DEBUG] Follow-up candidate parts:', candidate.content.parts);
              
              // Extract text parts
              const textParts = candidate.content.parts
                .filter((part: { text?: string }) => part.text)
                .map((part: { text?: string }) => part.text || '');
              if (textParts.length > 0) {
                responseText = textParts.join('');
                console.log('🤖 [DEBUG] Updated response text:', responseText);
                console.log('🤖 [DEBUG] Updated text parts count:', textParts.length);
                console.log('🤖 [DEBUG] Updated individual text parts:', textParts);
              }
              
              // Extract function call parts
              const functionCallParts = candidate.content.parts
                .filter((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => part.functionCall);
              functionCalls = functionCallParts.map((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => ({
                name: part.functionCall?.name || '',
                args: part.functionCall?.args || {}
              }));
              console.log('🤖 [DEBUG] Updated function calls:', functionCalls);
              console.log('🤖 [DEBUG] Updated function calls length:', functionCalls.length);
              console.log('🤖 [DEBUG] Updated raw function call parts:', functionCallParts);
              
              // Better task completion detection
              if (functionCalls.length === 0 && candidate.finishReason === 'STOP') {
                // Check if we've done meaningful work
                const hasWriteActions = toolResults.some(result => result.includes('write_file'));
                const hasReadActions = toolResults.some(result => result.includes('read_file'));
                const hasSearchActions = toolResults.some(result => result.includes('grep_search') || result.includes('list_files'));
                
                if (hasWriteActions || (hasReadActions && hasSearchActions)) {
                  console.log('🤖 [DEBUG] Task completion detected - no more function calls and meaningful work was done');
                  break;
                }
              }
            }
          }
        } catch (error) {
          console.error('🤖 [DEBUG] Error updating response data:', error);
          break;
        }
      }
      
      if (iterationCount >= maxIterations) {
        console.warn(`🔧 [Tools] Reached max iterations (${maxIterations}), stopping loop`);
        responseText += '\n\n[Note: Function call loop was stopped to prevent infinite iteration]';
      }

      // Add context about what was actually accomplished if not already present
      const hasWriteActions = toolResults.some(result => result.includes('write_file'));
      const writeFileCount = toolResults.filter(result => result.includes('write_file')).length;
      
      if (hasWriteActions && writeFileCount > 0 && !responseText.includes('✅')) {
        responseText += `\n\n✅ Task completed successfully. Modified ${writeFileCount} file(s) as requested.`;
      }
      
      console.log(`🤖 [DEBUG] Final response text:`, responseText);
      console.log(`🤖 [DEBUG] Tool summary - Writes: ${writeFileCount}, Total tools used: ${toolResults.length}`);
      console.log(`🤖 [AI] Gemini finished with response`);
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: [{type: 'text', text: responseText}] as ContentBlock[] },
      ]);
    } catch (error) {
      console.error('🤖 [AI] Error in Google GenAI:', error);
      setMessages(prev => [
        ...prev,
        { id: Date.now().toString(), role: 'assistant', content: [{type: 'text', text: 'Sorry, there was an error processing your request. Please try again.'}] as ContentBlock[] },
      ]);
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (isLoading) {
        stopGeneration();
      } else {
        sendMessage();
      }
    }
  };

  const renderContent = (content: ContentBlock[]) => {
    return content.map((block, index) => {
      if (block.type === 'text') {
        // Pre-process text to handle <thinking> tags
        let processedText = block.text;
        if (typeof processedText === 'string') {
          processedText = processedText.replace(
            /<thinking>(.*?)<\/thinking>/g,
            '<span class="text-gray-400 text-xs italic">$1</span>'
          );
        }

        return (
          <div key={index} className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                                 // Custom code block styling
                 code: ({className, children, ...props}) => {
                   const inline = !className?.includes('language-');
                  const match = /language-(\w+)/.exec(className || '');
                  const language = match ? match[1] : '';
                  
                  if (!inline) {
                    return (
                      <div className="my-2">
                        {language && (
                          <div className="text-xs text-gray-500 bg-gray-50 px-2 py-1 border-b rounded-t">
                            {language}
                          </div>
                        )}
                        <pre className={`bg-gray-900 text-green-400 p-3 overflow-x-auto text-sm ${language ? 'rounded-b' : 'rounded'}`}>
                          <code {...props}>{children}</code>
                        </pre>
                      </div>
                    );
                  }
                  return (
                    <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono" {...props}>
                      {children}
                    </code>
                  );
                },
                // Custom styling for other elements
                p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
                h1: ({children}) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                h2: ({children}) => <h2 className="text-base font-bold mb-2">{children}</h2>,
                h3: ({children}) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
                ul: ({children}) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                ol: ({children}) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                li: ({children}) => <li className="mb-1">{children}</li>,
                blockquote: ({children}) => (
                  <blockquote className="border-l-4 border-gray-300 pl-4 italic my-2">
                    {children}
                  </blockquote>
                ),
                a: ({children, href}) => (
                  <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                strong: ({children}) => <strong className="font-bold">{children}</strong>,
                em: ({children}) => <em className="italic">{children}</em>,
                hr: () => <hr className="my-3 border-gray-300" />,
                table: ({children}) => (
                  <div className="overflow-x-auto my-2">
                    <table className="min-w-full border border-gray-300 text-xs">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({children}) => <thead className="bg-gray-100">{children}</thead>,
                tbody: ({children}) => <tbody>{children}</tbody>,
                tr: ({children}) => <tr className="border-b border-gray-300">{children}</tr>,
                th: ({children}) => <th className="px-2 py-1 text-left font-semibold">{children}</th>,
                td: ({children}) => <td className="px-2 py-1">{children}</td>,
              }}
            >
              {processedText}
            </ReactMarkdown>
          </div>
        );
      }
      if (block.type === 'tool_use') {
        return (
          <div key={index} className="bg-gray-200 p-2 rounded my-1">
            <p className="font-mono text-xs">Tool: {block.name}</p>
            <pre className="font-mono text-xs bg-gray-800 text-white p-2 rounded mt-1">
              {JSON.stringify(block.input, null, 2)}
            </pre>
          </div>
        );
      }
      return null;
    });
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 transition-colors">
      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-2 border-b dark:border-gray-700 flex items-center justify-between transition-colors">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors">AI Chat</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
              (apiProvider === 'anthropic' && apiStatus.anthropic) ||
              (apiProvider === 'google' && apiStatus.google) 
                ? 'bg-green-500' : 'bg-red-500'}`}>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400 transition-colors">
            {
              (apiProvider === 'anthropic' && apiStatus.anthropic) ||
              (apiProvider === 'google' && apiStatus.google) 
                ? 'Connected' : 'API Key Missing'
            }
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-white dark:bg-gray-800 transition-colors">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] ${
                message.role === 'user'
                  ? 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200'
                  : 'text-gray-800 dark:text-gray-200'
              } transition-colors`}
            >
              {renderContent(message.content)}
              <div className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-500 dark:text-gray-400'
              } transition-colors`}>
                {/* We don't have a timestamp anymore, can be added back if needed */}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
            <div className="flex justify-start">
                <div className="max-w-[80%] text-gray-800 dark:text-gray-200 transition-colors">
                    <div className="flex items-center gap-2">
                        <span>{loadingMessage}</span>
                        <div className="flex gap-1">
                            <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                            <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                            <div className="w-1 h-1 bg-gray-500 dark:bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                        </div>
                    </div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t dark:border-gray-700 p-4 bg-white dark:bg-gray-800 transition-colors">
        <div className="border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 p-3 transition-colors">
          {/* First row: Text area */}
          <div className="mb-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              disabled={
                  isLoading ||
                  (apiProvider === 'anthropic' && !apiStatus.anthropic) ||
                  (apiProvider === 'google' && !apiStatus.google)
              }
              className="w-full resize-none border-0 bg-transparent text-gray-900 dark:text-white text-sm focus:outline-none disabled:bg-transparent placeholder:text-gray-500 dark:placeholder:text-gray-400 transition-colors"
              rows={1}
              style={{
                minHeight: '1.5rem',
                maxHeight: '8rem',
                height: 'auto',
                overflowY: input.split('\n').length > 3 ? 'auto' : 'hidden'
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                const newHeight = Math.min(target.scrollHeight, 128); // 8rem = 128px
                target.style.height = `${newHeight}px`;
              }}
            />
          </div>
          
          {/* Second row: Model selection and send button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <select 
                value={apiProvider} 
                onChange={e => setApiProvider(e.target.value as ApiProvider)}
                className="text-xs rounded border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-white px-2 py-1 transition-colors"
              >
                <option value="anthropic">Claude</option>
                <option value="google">Gemini</option>
              </select>
              <span className="text-xs text-gray-500 dark:text-gray-400 transition-colors">
                Press Enter to send, Shift+Enter for new line
              </span>
            </div>
            
            <button
              onClick={isLoading ? stopGeneration : sendMessage}
              disabled={
                  !isLoading && (
                    !input.trim() ||
                    (apiProvider === 'anthropic' && !apiStatus.anthropic) ||
                    (apiProvider === 'google' && !apiStatus.google)
                  )
              }
              className={`w-8 h-8 flex items-center justify-center rounded-full disabled:cursor-not-allowed transition-colors ${
                isLoading 
                  ? 'bg-red-500 hover:bg-red-600 text-white' 
                  : 'bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white'
              }`}
            >
              {isLoading ? (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel; 