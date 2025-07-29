# BaseBase Editor

A browser-based integrated development environment (IDE) that runs entirely in your web browser using WebContainers. Clone, edit, and preview GitHub repositories with hot reload - no local development environment required.

## 🚀 Features

- **🌐 Browser-Based**: Complete IDE running in your browser with no installations
- **📦 WebContainer Integration**: Full Node.js runtime environment in the browser
- **🔗 GitHub Integration**: Clone and edit repositories directly from GitHub
- **🔥 Hot Reload**: Live preview with automatic updates as you edit
- **📝 Code Editor**: Monaco Editor with syntax highlighting for multiple languages
- **📁 File Explorer**: Navigate and manage repository files
- **⚡ Live Preview**: Real-time preview of your web applications

## 🎯 How It Works

1. **Enter a GitHub repository URL** via URL structure (`/PROJECT?repo=https://github.com/owner/repo`)
2. **Authenticate with GitHub** using a personal access token
3. **WebContainer boots** and clones the repository into a browser-based Node.js environment
4. **Dependencies install** automatically via npm
5. **Development server starts** with hot reload enabled
6. **Edit and preview** your code in real-time

## 🔧 Usage

### Quick Start

1. Visit the application with a project ID and repository URL:

   ```
   https://your-app.com/PROJECT?repo=https://github.com/username/repository-name
   ```

2. When prompted, enter your GitHub Personal Access Token

   - Go to [GitHub Settings > Developer Settings > Personal Access Tokens](https://github.com/settings/tokens)
   - Generate a token with `repo` scope for private repos, or `public_repo` for public repos
   - Paste the token when prompted

3. The IDE will automatically:
   - Clone the repository
   - Install dependencies (`npm install`)
   - Start the development server (`npm run dev`)
   - Display the live preview

### Supported Project Types

Any project with a `package.json` and npm scripts, including:

- React applications
- Vue.js projects
- Vite-based projects
- Next.js applications
- Express servers
- Static sites

## 🏗️ Architecture

### Components

- **DevEnvironment**: Main orchestrator managing WebContainer lifecycle
- **FileExplorer**: Tree view for browsing repository files
- **CodeEditor**: Monaco-based editor with syntax highlighting
- **PreviewPane**: Live iframe preview with refresh capability
- **GitHubAuth**: GitHub token authentication and storage

### Technical Stack

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Code Editor**: Monaco Editor (VS Code editor in browser)
- **Runtime**: WebContainer API (browser-based Node.js)
- **GitHub API**: Repository cloning and file access
- **Authentication**: GitHub Personal Access Tokens

### WebContainer Integration

WebContainers provide a complete Node.js environment in the browser:

- File system with full read/write access
- Process spawning (npm, node commands)
- Network access for package installation
- Port forwarding for development servers

## ⚙️ Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/basebase-editor
cd basebase-editor

# Install dependencies
npm install

# Start development server
npm run dev
```

### Cross-Origin Isolation

WebContainers require cross-origin isolation. The Vite config includes:

```typescript
// vite.config.ts
server: {
  headers: {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
  }
}
```

### Environment Variables

No environment variables required - authentication uses GitHub tokens provided by users.

## 🔒 Security & Privacy

- **GitHub tokens** are stored locally in browser localStorage
- **Repository data** remains in the browser WebContainer
- **No server-side storage** of code or credentials
- **Cross-origin isolation** ensures secure execution environment

## 🎨 Layout

The IDE uses a three-panel layout:

- **File Explorer** (10%): Repository file tree
- **Code Editor** (40%): Monaco editor with syntax highlighting
- **Live Preview** (50%): Development server preview

## 🧩 Supported File Types

- **TypeScript/JavaScript**: `.ts`, `.tsx`, `.js`, `.jsx`
- **Styling**: `.css`, `.scss`, `.less`
- **Markup**: `.html`, `.vue`, `.svelte`
- **Config**: `.json`, `.yaml`, `.toml`
- **Documentation**: `.md`, `.mdx`

## 📝 Example Usage

```
# Open a React project
https://your-app.com/my-react-app?repo=https://github.com/facebook/create-react-app

# Open a Vue project
https://your-app.com/my-vue-app?repo=https://github.com/vuejs/create-vue

# Open any Vite project
https://your-app.com/my-vite-app?repo=https://github.com/vitejs/vite-react-ts-starter
```

## 🚧 Limitations

- **Large repositories** may take time to clone and install
- **Memory usage** limited by browser capabilities
- **Network requests** required for package installation
- **GitHub rate limits** apply to API requests

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [WebContainer API](https://webcontainer.io/) - Browser-based Node.js runtime
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor
- [GitHub API](https://docs.github.com/en/rest) - Repository access
- [Vite](https://vitejs.dev/) - Build tool and development server
