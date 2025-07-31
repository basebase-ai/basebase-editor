import React, { useState, useRef, useEffect } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, Type } from '@google/genai';
import ReactMarkdown from 'react-markdown';
import WebContainerManager from '../utils/webcontainer-manager';
import type { WebContainer } from '@webcontainer/api';
import type { ContentBlock, MessageParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages';

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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const anthropic = new Anthropic({
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true,
  });

  // Only initialize GoogleGenAI if we have a valid API key
  const google = import.meta.env.VITE_GEMINI_API_KEY 
    ? new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY })
    : null;

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

CURRENT PROJECT CONTEXT:
- Repository structure:
${repoStructure}
- Current errors: ${currentErrors}
- Recently modified: ${recentFiles}

WORKFLOW:
1. Use list_files to see what files are available or use grep_search to find specific text patterns across files (this is crucial for finding where text appears)
2. Use read_file to examine specific files in detail
3. Make targeted changes with write_file
4. Verify changes with run_command (lint/test)

IMPORTANT: When asked to find or change specific text, ALWAYS use grep_search first to locate where the text appears. This is much more efficient than reading files one by one.

Always read files before modifying them. When making changes, explain your reasoning and check for errors afterward. Please be as concise as possible, summarizing your ideas, your approach, and your completed work in a few lines at a time.`;
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

    console.log(`🤖 [AI] Sending request to ${apiProvider}...`);

    try {
      if (apiProvider === 'anthropic') {
        await sendAnthropicMessage(apiMessages);
      } else {
        await sendGoogleMessage(apiMessages);
      }
    } catch (error) {
      console.error(`🤖 [AI] Error:`, error);
      // Handle error message display
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      console.log(`🤖 [AI] Request completed`);
    }
  };

  const sendAnthropicMessage = async (apiMessages: MessageParam[]) => {
    const systemPrompt = await getSystemPrompt();
    const res = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      system: systemPrompt,
      messages: apiMessages,
      tools: [
        {
          name: 'read_file',
          description: 'Read the contents of a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
        {
          name: 'write_file',
          description: 'Write/update a file',
          input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
        },
        {
          name: 'list_files',
          description: 'List files in directory (with glob patterns)',
          input_schema: { type: 'object', properties: { pattern: { type: 'string' }, include_hidden: { type: 'boolean' } }, required: ['pattern'] },
        },
        {
          name: 'grep_search',
          description: 'Search for text patterns across all files in the repository',
          input_schema: { 
            type: 'object', 
            properties: { 
              pattern: { type: 'string', description: 'The text pattern to search for' },
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
          description: 'Execute commands (lint, test, build)',
          input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] },
        },
      ],
    });

    let apiResponse = res;
    const newApiMessages: MessageParam[] = [...apiMessages, { role: apiResponse.role, content: apiResponse.content }];

    while (apiResponse.stop_reason === 'tool_use') {
      const toolUses = apiResponse.content.filter((c): c is Anthropic.Messages.ToolUseBlock => c.type === 'tool_use');
      console.log(`🔧 [Tools] Claude wants to use: ${toolUses.map(t => t.name).join(', ')}`);
      
      const toolResults = await Promise.all(
        toolUses.map(async (toolUse): Promise<ToolResultBlockParam> => {
          const { name, input } = toolUse;
          let toolOutput: string | undefined;
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
            if (name === 'read_file' && typeof toolInput.path === 'string') {
              toolOutput = await WebContainerManager.readFile(toolInput.path);
              console.log(`🔧 [Tools] Read file: ${toolInput.path}`);
            } else if (name === 'write_file' && typeof toolInput.path === 'string' && typeof toolInput.content === 'string') {
              await WebContainerManager.writeFile(toolInput.path, toolInput.content);
              toolOutput = `File ${toolInput.path} written successfully.`;
              console.log(`🔧 [Tools] Wrote file: ${toolInput.path}`);
            } else if (name === 'list_files' && typeof toolInput.pattern === 'string') {
              const includeHidden = typeof toolInput.include_hidden === 'boolean' ? toolInput.include_hidden : false;
              const files = await WebContainerManager.listFiles(toolInput.pattern, '.', includeHidden);
              toolOutput = files.join('\n');
              console.log(`🔧 [Tools] Listed ${files.length} files`);
            } else if (name === 'grep_search' && typeof toolInput.pattern === 'string') {
              const options = {
                caseSensitive: typeof toolInput.case_sensitive === 'boolean' ? toolInput.case_sensitive : false,
                wholeWords: typeof toolInput.whole_words === 'boolean' ? toolInput.whole_words : false,
                filePattern: typeof toolInput.file_pattern === 'string' ? toolInput.file_pattern : "**/*",
                maxResults: typeof toolInput.max_results === 'number' ? toolInput.max_results : 100,
              };
              toolOutput = await WebContainerManager.grepSearch(toolInput.pattern, options);
              console.log(`🔧 [Tools] Searched for: "${toolInput.pattern}"`);
            } else if (name === 'run_command' && typeof toolInput.command === 'string' && Array.isArray(toolInput.args)) {
              toolOutput = await WebContainerManager.runCommand(toolInput.command, toolInput.args as string[]);
              console.log(`🔧 [Tools] Ran command: ${toolInput.command}`);
            } else {
              toolOutput = `Unknown tool or invalid arguments: ${name}`;
            }
          } catch (e: unknown) {
              const error = e as Error;
              toolOutput = `Error executing tool ${name}: ${error.message}`;
              console.error(`🔧 [Tools] Error with ${name}:`, error.message);
          }

          return {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: [{ type: 'text', text: toolOutput ?? 'Tool executed with no output.' }],
          };
        })
      );
      
      newApiMessages.push({ role: 'user', content: toolResults });

      setLoadingMessage('Thinking...');
      console.log(`🔧 [Tools] Sending results back to Claude...`);
      apiResponse = await anthropic.messages.create({
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
      });
      
      newApiMessages.push({role: apiResponse.role, content: apiResponse.content });
    }

    console.log(`🤖 [AI] Claude finished with response`);
    setMessages(prev => [
      ...prev,
      { id: apiResponse.id, role: 'assistant', content: apiResponse.content },
    ]);
  }

  const sendGoogleMessage = async (apiMessages: MessageParam[]) => {
    if (!google) {
      console.error('🤖 [AI] Google AI client not initialized - missing API key');
      return;
    }

    const systemPrompt = await getSystemPrompt();
    
    // Define function declarations for Gemini
    const readFileDeclaration = {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: {
            type: Type.STRING,
            description: 'Path to the file to read'
          }
        },
        required: ['path']
      }
    };

    const writeFileDeclaration = {
      name: 'write_file',
      description: 'Write/update a file',
      parameters: {
        type: Type.OBJECT,
        properties: {
          path: {
            type: Type.STRING,
            description: 'Path to the file to write'
          },
          content: {
            type: Type.STRING,
            description: 'Content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    };

    const listFilesDeclaration = {
      name: 'list_files',
      description: 'List files in directory (with glob patterns)',
      parameters: {
        type: Type.OBJECT,
        properties: {
          pattern: {
            type: Type.STRING,
            description: 'Glob pattern to match files (e.g., "*.js", "**/*.tsx")'
          },
          include_hidden: {
            type: Type.BOOLEAN,
            description: 'Whether to include hidden files (default: false)'
          }
        },
        required: ['pattern']
      }
    };

    const grepSearchDeclaration = {
      name: 'grep_search',
      description: 'Search for text patterns across all files in the repository. Use this to find where specific text appears before making changes.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          pattern: {
            type: Type.STRING,
            description: 'The exact text pattern to search for (e.g., "Improve This", "button", "function")'
          },
          case_sensitive: {
            type: Type.BOOLEAN,
            description: 'Whether the search should be case sensitive (default: false)'
          },
          whole_words: {
            type: Type.BOOLEAN,
            description: 'Whether to match whole words only (default: false)'
          },
          file_pattern: {
            type: Type.STRING,
            description: 'File pattern to limit search scope (e.g., "*.js", "*.tsx", "*.html")'
          },
          max_results: {
            type: Type.NUMBER,
            description: 'Maximum number of results to return (default: 100)'
          }
        },
        required: ['pattern']
      }
    };

    const runCommandDeclaration = {
      name: 'run_command',
      description: 'Execute commands (lint, test, build)',
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: {
            type: Type.STRING,
            description: 'Command to execute'
          },
          args: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
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

    try {
      console.log('🤖 [DEBUG] Starting Google GenAI request...');
      let response = await google.models.generateContent({
        model: "gemini-2.0-flash",
        contents: fullPrompt,
        config: {
          tools: [{
            functionDeclarations: functionDeclarations
          }]
        }
      });

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
            
            // Extract function call parts
            const functionCallParts = candidate.content.parts
              .filter((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => part.functionCall);
            functionCalls = functionCallParts.map((part: { functionCall?: { name?: string; args?: Record<string, unknown> } }) => ({
              name: part.functionCall?.name || '',
              args: part.functionCall?.args || {}
            }));
            console.log('🤖 [DEBUG] Extracted function calls:', functionCalls);
          }
        }
        
        console.log('🤖 [DEBUG] Function calls length:', functionCalls.length);
      } catch (error) {
        console.error('🤖 [DEBUG] Error extracting response data:', error);
      }

      while (functionCalls.length > 0 && iterationCount < maxIterations) {
        iterationCount++;
        console.log(`🤖 [DEBUG] Starting iteration ${iterationCount}/${maxIterations}`);
        console.log(`🔧 [Tools] Gemini wants to use: ${functionCalls.map((fc: { name?: string }) => fc.name || 'unknown').join(', ')}`);
        
        // Clear functionCalls to prevent infinite loop
        const currentFunctionCalls = [...functionCalls];
        functionCalls = [];
        console.log(`🤖 [DEBUG] Cleared functionCalls array, processing ${currentFunctionCalls.length} calls`);
        
        // Check for repeated actions to prevent loops
        const currentActions = currentFunctionCalls.map(fc => `${fc.name}:${JSON.stringify(fc.args)}`);
        const recentActions = toolResults.slice(-5).map(result => {
          const match = result.match(/^Function (\w+) result:/);
          return match ? match[1] : '';
        });
        
        console.log(`🤖 [DEBUG] Current actions:`, currentActions);
        console.log(`🤖 [DEBUG] Recent actions:`, recentActions);
        
        // Check for repeated grep_search with same arguments
        const currentGrepSearches = currentActions.filter(action => action.startsWith('grep_search'));
        const recentGrepSearches = toolResults.slice(-3).filter(result => result.includes('grep_search'));
        
        console.log(`🤖 [DEBUG] Current grep searches:`, currentGrepSearches);
        console.log(`🤖 [DEBUG] Recent grep searches count:`, recentGrepSearches.length);
        
        // More aggressive detection of repeated searches
        if (currentGrepSearches.length > 0) {
          // Check if we're doing the same search as in the last few iterations
          const searchPatterns = currentGrepSearches.map(action => {
            try {
              const argsStr = action.split('grep_search:')[1];
              const args = JSON.parse(argsStr);
              return args.pattern;
            } catch {
              return action;
            }
          });
          
          console.log(`🤖 [DEBUG] Current search patterns:`, searchPatterns);
          
          // Check if any current search pattern was already used recently
          const hasRepeatedPattern = searchPatterns.some(pattern => {
            return toolResults.slice(-4).some(result => 
              result.includes(`Searched for: "${pattern}"`) || result.includes(`Searched for: ${pattern}`)
            );
          });
          
          if (hasRepeatedPattern && recentGrepSearches.length >= 2) {
            console.log(`🤖 [DEBUG] Detected repeated search patterns, breaking loop to prevent infinite iteration`);
            responseText += '\n\n✅ Search completed. All relevant files have been found and examined.';
            break;
          }
        }
        
        // If we're repeating the same write_file action, break the loop
        if (currentActions.some(action => action.startsWith('write_file')) && 
            recentActions.filter(action => action === 'write_file').length >= 2) {
          console.log(`🤖 [DEBUG] Detected repeated write_file actions, breaking loop to prevent infinite iteration`);
          responseText += '\n\n✅ Task completed successfully. The sign-out button has been changed to solid blue.';
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
            if (name === 'read_file' && typeof args?.path === 'string') {
              toolOutput = await WebContainerManager.readFile(args.path);
              console.log(`🔧 [Tools] Read file: ${args.path}`);
            } else if (name === 'write_file' && typeof args?.path === 'string' && typeof args?.content === 'string') {
              await WebContainerManager.writeFile(args.path, args.content);
              toolOutput = `File ${args.path} written successfully.`;
              console.log(`🔧 [Tools] Wrote file: ${args.path}`);
            } else if (name === 'list_files' && typeof args?.pattern === 'string') {
              const includeHidden = typeof args?.include_hidden === 'boolean' ? args.include_hidden : false;
              const files = await WebContainerManager.listFiles(args.pattern, '.', includeHidden);
              toolOutput = files.join('\n');
              console.log(`🔧 [Tools] Listed ${files.length} files`);
            } else if (name === 'grep_search' && typeof args?.pattern === 'string') {
              const options = {
                caseSensitive: typeof args?.case_sensitive === 'boolean' ? args.case_sensitive : false,
                wholeWords: typeof args?.whole_words === 'boolean' ? args.whole_words : false,
                filePattern: typeof args?.file_pattern === 'string' ? args.file_pattern : "**/*",
                maxResults: typeof args?.max_results === 'number' ? args.max_results : 100,
              };
              toolOutput = await WebContainerManager.grepSearch(args.pattern, options);
              console.log(`🔧 [Tools] Searched for: "${args.pattern}"`);
            } else if (name === 'run_command' && typeof args?.command === 'string' && Array.isArray(args?.args)) {
              toolOutput = await WebContainerManager.runCommand(args.command, args.args as string[]);
              console.log(`🔧 [Tools] Ran command: ${args.command}`);
            } else {
              toolOutput = `Unknown tool or invalid arguments: ${name}`;
            }
          } catch (e: unknown) {
            const error = e as Error;
            toolOutput = `Error executing tool ${name}: ${error.message}`;
            console.error(`🔧 [Tools] Error with ${name}:`, error.message);
          }

          toolResults.push(`Function ${name} result:\n${toolOutput ?? 'Tool executed with no output.'}`);
        }

        // Send tool results back to Gemini
        setLoadingMessage('Thinking...');
        console.log(`🔧 [Tools] Sending results back to Gemini...`);
        console.log(`🤖 [DEBUG] Tool results count: ${toolResults.length}`);
        
        const toolResultsPrompt = `${fullPrompt}\n\nTool execution results:\n${toolResults.join('\n\n')}\n\nBased on these tool results, please continue with your task. If you have already found the files you need and made the necessary changes, you can finish. If you need to search for specific text, use grep_search. If you need to examine a file in detail, use read_file. If you need to make changes, use write_file.`;
        
        console.log(`🤖 [DEBUG] Tool results prompt length:`, toolResultsPrompt.length);
        console.log(`🤖 [DEBUG] Last 3 tool results:`, toolResults.slice(-3));
        
        console.log('🤖 [DEBUG] Making follow-up request to Google GenAI...');
        response = await google.models.generateContent({
          model: "gemini-2.0-flash",
          contents: toolResultsPrompt,
          config: {
            tools: [{
              functionDeclarations: functionDeclarations
            }]
          }
        });

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
              
              // If there are no function calls and we have recent write_file actions, consider task complete
              if (functionCalls.length === 0 && candidate.finishReason === 'STOP') {
                const recentWriteActions = toolResults.filter(result => result.includes('write_file')).length;
                if (recentWriteActions > 0) {
                  console.log('🤖 [DEBUG] No more function calls and previous write actions detected - task appears complete');
                  responseText += '\n\n✅ Task completed successfully!';
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

      console.log(`🤖 [DEBUG] Final response text:`, responseText);
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
      sendMessage();
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
        <div className="flex items-center gap-4">
            <select 
                value={apiProvider} 
                onChange={e => setApiProvider(e.target.value as ApiProvider)}
                className="text-xs rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors"
            >
                <option value="anthropic">Claude</option>
                <option value="google">Gemini</option>
            </select>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                  (apiProvider === 'anthropic' && import.meta.env.VITE_ANTHROPIC_API_KEY) ||
                  (apiProvider === 'google' && import.meta.env.VITE_GEMINI_API_KEY && google) 
                    ? 'bg-green-500' : 'bg-red-500'}`}>
              </div>
              <span className="text-xs text-gray-500 dark:text-gray-400 transition-colors">
                {
                  (apiProvider === 'anthropic' && import.meta.env.VITE_ANTHROPIC_API_KEY) ||
                  (apiProvider === 'google' && import.meta.env.VITE_GEMINI_API_KEY && google) 
                    ? 'Connected' : 'API Key Missing'
                }
              </span>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-white dark:bg-gray-800 transition-colors">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
              } transition-colors`}
            >
              {renderContent(message.content)}
              <div className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-brand-200' : 'text-gray-500 dark:text-gray-400'
              } transition-colors`}>
                {/* We don't have a timestamp anymore, can be added back if needed */}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
            <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 transition-colors">
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
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={
                isLoading ||
                (apiProvider === 'anthropic' && !import.meta.env.VITE_ANTHROPIC_API_KEY) ||
                (apiProvider === 'google' && (!import.meta.env.VITE_GEMINI_API_KEY || !google))
            }
            className="flex-1 resize-none border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 dark:focus:ring-brand-400 focus:border-transparent disabled:bg-gray-100 dark:disabled:bg-gray-800 transition-colors"
            rows={3}
          />
          <button
            onClick={sendMessage}
            disabled={
                isLoading || 
                !input.trim() ||
                (apiProvider === 'anthropic' && !import.meta.env.VITE_ANTHROPIC_API_KEY) ||
                (apiProvider === 'google' && (!import.meta.env.VITE_GEMINI_API_KEY || !google))
            }
            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Send
          </button>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 transition-colors">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel; 