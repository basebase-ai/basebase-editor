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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
1. Use list_files and read_file to understand the codebase
2. Use get_diagnostics to check for errors before/after changes
3. Make targeted changes with write_file
4. Verify changes with run_command (lint/test)

Always read files before modifying them. When making changes, explain your reasoning and check for errors afterward.`;
  };
  
  const sendMessage = async (): Promise<void> => {
    if (!input.trim() || !webcontainer) return;

    const userMessageContent = input.trim();
    console.log(`🤖 [AI Assistant] User message: "${userMessageContent}"`);
    console.log(`🤖 [AI Assistant] Using provider: ${apiProvider}`);
    
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
    console.log(`🤖 [AI Assistant] Starting ${apiProvider} request...`);

    try {
      if (apiProvider === 'anthropic') {
        await sendAnthropicMessage(apiMessages);
      } else {
        await sendGoogleMessage(apiMessages);
      }
    } catch (error) {
      console.error(`🤖 [AI Assistant] Error sending message:`, error);
      // Handle error message display
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
      console.log(`🤖 [AI Assistant] Request completed`);
    }
  };

  const sendAnthropicMessage = async (apiMessages: MessageParam[]) => {
    console.log(`🤖 [Anthropic] Preparing system prompt...`);
    const systemPrompt = await getSystemPrompt();
    console.log(`🤖 [Anthropic] System prompt length: ${systemPrompt.length} chars`);
    
    console.log(`🤖 [Anthropic] Sending initial request to Claude...`);
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
      console.log(`🤖 [Anthropic] Claude wants to use ${toolUses.length} tool(s): ${toolUses.map(t => t.name).join(', ')}`);
      
      const toolResults = await Promise.all(
        toolUses.map(async (toolUse): Promise<ToolResultBlockParam> => {
          const { name, input } = toolUse;
          let toolOutput: string | undefined;
          const toolInput = input as Record<string, unknown>;

          // Update loading message based on tool being used
          if (name === 'read_file') {
            setLoadingMessage('Reading file...');
            console.log(`🔧 [Tool] Reading file: ${toolInput.path}`);
          } else if (name === 'write_file') {
            setLoadingMessage('Writing file...');
            console.log(`🔧 [Tool] Writing file: ${toolInput.path}`);
          } else if (name === 'list_files') {
            setLoadingMessage('Listing files...');
            console.log(`🔧 [Tool] Listing files with pattern: ${toolInput.pattern}`);
          } else if (name === 'run_command') {
            setLoadingMessage('Running command...');
            console.log(`🔧 [Tool] Running command: ${toolInput.command} ${Array.isArray(toolInput.args) ? toolInput.args.join(' ') : ''}`);
          }

          try {
            if (name === 'read_file' && typeof toolInput.path === 'string') {
              toolOutput = await WebContainerManager.readFile(toolInput.path);
              console.log(`🔧 [Tool] Read ${toolOutput?.length || 0} characters from ${toolInput.path}`);
            } else if (name === 'write_file' && typeof toolInput.path === 'string' && typeof toolInput.content === 'string') {
              await WebContainerManager.writeFile(toolInput.path, toolInput.content);
              toolOutput = `File ${toolInput.path} written successfully.`;
              console.log(`🔧 [Tool] Wrote ${toolInput.content.length} characters to ${toolInput.path}`);
            } else if (name === 'list_files' && typeof toolInput.pattern === 'string') {
              const includeHidden = typeof toolInput.include_hidden === 'boolean' ? toolInput.include_hidden : false;
              const files = await WebContainerManager.listFiles(toolInput.pattern, '.', includeHidden);
              toolOutput = files.join('\n');
              console.log(`🔧 [Tool] Found ${files.length} files matching pattern: ${toolInput.pattern}`);
            } else if (name === 'run_command' && typeof toolInput.command === 'string' && Array.isArray(toolInput.args)) {
              toolOutput = await WebContainerManager.runCommand(toolInput.command, toolInput.args as string[]);
              console.log(`🔧 [Tool] Command completed with ${toolOutput?.length || 0} characters of output`);
            } else {
              toolOutput = `Unknown tool or invalid arguments: ${name}`;
              console.warn(`🔧 [Tool] Unknown tool or invalid arguments: ${name}`);
            }
          } catch (e: unknown) {
              const error = e as Error;
              toolOutput = `Error executing tool ${name}: ${error.message}`;
              console.error(`🔧 [Tool] Error executing ${name}:`, error.message);
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
      console.log(`🤖 [Anthropic] Sending tool results back to Claude...`);
      apiResponse = await anthropic.messages.create({
          model: 'claude-3-opus-20240229',
          max_tokens: 4096,
          system: systemPrompt,
          messages: newApiMessages,
          tools: [
            { name: 'read_file', description: 'Read the contents of a file', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
            { name: 'write_file', description: 'Write/update a file', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
            { name: 'list_files', description: 'List files in directory (with glob patterns)', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, include_hidden: { type: 'boolean' } }, required: ['pattern'] } },
            { name: 'run_command', description: 'Execute commands (lint, test, build)', input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command', 'args'] } },
          ],
      });
      
      newApiMessages.push({role: apiResponse.role, content: apiResponse.content });
    }

    console.log(`🤖 [Anthropic] Claude finished, final response length: ${apiResponse.content.map(c => 'text' in c ? c.text?.length || 0 : 0).reduce((a, b) => a + b, 0)} chars`);
    setMessages(prev => [
      ...prev,
      { id: apiResponse.id, role: 'assistant', content: apiResponse.content },
    ]);
  }

  const sendGoogleMessage = async (apiMessages: MessageParam[]) => {
    if (!google) {
      console.error('🤖 [Google] Google AI client not initialized - missing API key');
      return;
    }

    console.log(`🤖 [Google] Preparing system prompt...`);
    const systemPrompt = await getSystemPrompt();
    console.log(`🤖 [Google] System prompt length: ${systemPrompt.length} chars`);
    
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

    const functionDeclarations = [readFileDeclaration, writeFileDeclaration, listFilesDeclaration, runCommandDeclaration];

    // Build the conversation history for Gemini
    const conversationHistory = apiMessages.map(msg => {
      const content = Array.isArray(msg.content) 
        ? msg.content.map(c => 'text' in c ? c.text : '').join('') 
        : msg.content as string;
      return `${msg.role}: ${content}`;
    }).join('\n\n');

    const fullPrompt = `${systemPrompt}\n\nConversation so far:\n${conversationHistory}`;
    console.log(`🤖 [Google] Sending request to Gemini with tools...`);

    let response = await google.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: fullPrompt,
      config: {
        tools: [{
          functionDeclarations: functionDeclarations
        }]
      }
    });

    // Handle function calls in a loop similar to Anthropic
    let responseText = response.text || '';
    const toolResults: string[] = [];

    while (response.functionCalls && response.functionCalls.length > 0) {
      console.log(`🤖 [Google] Gemini wants to use ${response.functionCalls.length} tool(s): ${response.functionCalls.map(fc => fc.name).join(', ')}`);
      
      for (const functionCall of response.functionCalls) {
        const { name, args } = functionCall;
        let toolOutput: string | undefined;

        // Update loading message based on tool being used
        if (name === 'read_file') {
          setLoadingMessage('Reading file...');
          console.log(`🔧 [Tool] Reading file: ${args?.path}`);
        } else if (name === 'write_file') {
          setLoadingMessage('Writing file...');
          console.log(`🔧 [Tool] Writing file: ${args?.path}`);
        } else if (name === 'list_files') {
          setLoadingMessage('Listing files...');
          console.log(`🔧 [Tool] Listing files with pattern: ${args?.pattern}`);
        } else if (name === 'run_command') {
          setLoadingMessage('Running command...');
          console.log(`🔧 [Tool] Running command: ${args?.command} ${Array.isArray(args?.args) ? args.args.join(' ') : ''}`);
        }

        try {
          if (name === 'read_file' && typeof args?.path === 'string') {
            toolOutput = await WebContainerManager.readFile(args.path);
            console.log(`🔧 [Tool] Read ${toolOutput?.length || 0} characters from ${args.path}`);
          } else if (name === 'write_file' && typeof args?.path === 'string' && typeof args?.content === 'string') {
            await WebContainerManager.writeFile(args.path, args.content);
            toolOutput = `File ${args.path} written successfully.`;
            console.log(`🔧 [Tool] Wrote ${args.content.length} characters to ${args.path}`);
          } else if (name === 'list_files' && typeof args?.pattern === 'string') {
            const includeHidden = typeof args?.include_hidden === 'boolean' ? args.include_hidden : false;
            const files = await WebContainerManager.listFiles(args.pattern, '.', includeHidden);
            toolOutput = files.join('\n');
            console.log(`🔧 [Tool] Found ${files.length} files matching pattern: ${args.pattern}`);
          } else if (name === 'run_command' && typeof args?.command === 'string' && Array.isArray(args?.args)) {
            toolOutput = await WebContainerManager.runCommand(args.command, args.args as string[]);
            console.log(`🔧 [Tool] Command completed with ${toolOutput?.length || 0} characters of output`);
          } else {
            toolOutput = `Unknown tool or invalid arguments: ${name}`;
            console.warn(`🔧 [Tool] Unknown tool or invalid arguments: ${name}`);
          }
        } catch (e: unknown) {
          const error = e as Error;
          toolOutput = `Error executing tool ${name}: ${error.message}`;
          console.error(`🔧 [Tool] Error executing ${name}:`, error.message);
        }

        toolResults.push(`Function ${name} result: ${toolOutput ?? 'Tool executed with no output.'}`);
      }

      // Send tool results back to Gemini
      setLoadingMessage('Thinking...');
      console.log(`🤖 [Google] Sending tool results back to Gemini...`);
      
      const toolResultsPrompt = `${fullPrompt}\n\nTool execution results:\n${toolResults.join('\n\n')}\n\nPlease provide your response based on the tool results above.`;
      
      response = await google.models.generateContent({
        model: "gemini-2.5-flash",
        contents: toolResultsPrompt,
        config: {
          tools: [{
            functionDeclarations: functionDeclarations
          }]
        }
      });

      if (response.text) {
        responseText = response.text;
      }
    }

    console.log(`🤖 [Google] Gemini response length: ${responseText.length} chars`);
    setMessages(prev => [
      ...prev,
      { id: Date.now().toString(), role: 'assistant', content: [{type: 'text', text: responseText}] as ContentBlock[] },
    ]);
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
              {block.text}
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
    <div className="h-full flex flex-col">
      <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">AI Chat</h3>
        <div className="flex items-center gap-4">
            <select 
                value={apiProvider} 
                onChange={e => setApiProvider(e.target.value as ApiProvider)}
                className="text-xs rounded border-gray-300"
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
              <span className="text-xs text-gray-500">
                {
                  (apiProvider === 'anthropic' && import.meta.env.VITE_ANTHROPIC_API_KEY) ||
                  (apiProvider === 'google' && import.meta.env.VITE_GEMINI_API_KEY && google) 
                    ? 'Connected' : 'API Key Missing'
                }
              </span>
            </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {renderContent(message.content)}
              <div className={`text-xs mt-1 ${
                message.role === 'user' ? 'text-blue-200' : 'text-gray-500'
              }`}>
                {/* We don't have a timestamp anymore, can be added back if needed */}
              </div>
            </div>
          </div>
        ))}
        {isLoading && (
            <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg px-3 py-2 bg-gray-100 text-gray-800">
                    <div className="flex items-center gap-2">
                        <span>{loadingMessage}</span>
                        <div className="flex gap-1">
                            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                            <div className="w-1 h-1 bg-gray-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
                        </div>
                    </div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-4">
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
            className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
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
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm font-medium"
          >
            Send
          </button>
        </div>
        <div className="text-xs text-gray-500 mt-2">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel; 