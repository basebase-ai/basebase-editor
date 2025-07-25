import { WebContainer } from "@webcontainer/api";

class WebContainerManager {
  private static instance: WebContainer | null = null;
  private static bootPromise: Promise<WebContainer> | null = null;

  static getInstance(): Promise<WebContainer> {
    // If we already have a booted instance, return it immediately.
    if (this.instance) {
      return Promise.resolve(this.instance);
    }

    // If a boot is already in progress, return the existing promise.
    // This prevents race conditions from multiple components trying to boot at once.
    if (this.bootPromise) {
      return this.bootPromise;
    }

    // Otherwise, start a new boot process.
    this.bootPromise = (async () => {
      try {
        if (!self.crossOriginIsolated) {
          throw new Error(
            "WebContainer requires cross-origin isolation. " +
              "Please ensure your page is served with proper COOP and COEP headers."
          );
        }

        console.log("Booting WebContainer...");
        const container = await WebContainer.boot();
        console.log("WebContainer booted successfully.");

        this.instance = container;
        return this.instance;
      } catch (error) {
        // On failure, clear the promise so a subsequent call can retry.
        this.bootPromise = null;
        console.error("WebContainer boot failed:", error);
        throw error;
      }
    })();

    return this.bootPromise;
  }

  static teardown(): void {
    if (this.instance) {
      // WebContainer doesn't have a public teardown method
      // Just clear our reference to allow for a new instance if needed.
      this.instance = null;
      this.bootPromise = null;
      console.log("WebContainer instance cleared");
    }
  }

  static hasInstance(): boolean {
    return this.instance !== null;
  }

  static async readFile(path: string): Promise<string> {
    const container = await this.getInstance();
    return container.fs.readFile(path, "utf-8");
  }

  static async writeFile(path: string, content: string): Promise<void> {
    const container = await this.getInstance();
    await container.fs.writeFile(path, content);
  }

  static async listFiles(
    pattern: string,
    basePath: string = ".",
    includeHidden: boolean = false
  ): Promise<string[]> {
    const container = await this.getInstance();
    const allFiles: string[] = [];

    // Read and parse .gitignore file
    let gitignorePatterns: RegExp[] = [];
    try {
      const gitignoreContent = await container.fs.readFile(
        ".gitignore",
        "utf-8"
      );
      gitignorePatterns = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")) // Remove empty lines and comments
        .map((pattern) => {
          // Convert gitignore pattern to regex
          let regexPattern = pattern
            .replace(/\./g, "\\.") // Escape dots
            .replace(/\*\*/g, "DOUBLE_STAR") // Temporarily replace **
            .replace(/\*/g, "[^/]*") // Single * matches anything except /
            .replace(/DOUBLE_STAR/g, ".*") // ** matches anything including /
            .replace(/\?/g, "[^/]"); // ? matches single char except /

          // Handle directory patterns (ending with /)
          if (pattern.endsWith("/")) {
            regexPattern = regexPattern.slice(0, -1) + "(/.*)?";
          }

          // Handle patterns starting with / (absolute from repo root)
          if (pattern.startsWith("/")) {
            regexPattern = "^" + regexPattern.slice(1) + "$";
          } else {
            regexPattern = "(^|.*/)" + regexPattern + "$";
          }

          return new RegExp(regexPattern);
        });
    } catch {
      // No .gitignore file or error reading it - use common defaults
      const defaultIgnores = [
        "node_modules",
        "dist",
        "build",
        ".git",
        ".DS_Store",
        "*.log",
        ".env",
        ".env.local",
        ".env.*.local",
        "coverage",
        ".nyc_output",
        ".cache",
      ];
      gitignorePatterns = defaultIgnores.map((pattern) => {
        const regexPattern = pattern
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, "[^/]");
        return new RegExp(`(^|.*/)${regexPattern}(/.*)?$`);
      });
    }

    // Improved glob to regex conversion that handles ** patterns
    const globToRegex = (glob: string) => {
      const regexString = glob
        .replace(/\./g, "\\.") // Escape dots
        .replace(/\*\*/g, "DOUBLE_STAR") // Temporarily replace **
        .replace(/\*/g, "[^/]*") // Single * matches anything except /
        .replace(/DOUBLE_STAR/g, ".*") // ** matches anything including /
        .replace(/\?/g, "[^/]"); // ? matches single char except /
      return new RegExp(`^${regexString}$`);
    };

    const re = globToRegex(pattern);

    // Check if a path should be ignored based on gitignore patterns
    const shouldIgnore = (path: string): boolean => {
      return gitignorePatterns.some((pattern) => pattern.test(path));
    };

    const readDirRecursive = async (dir: string) => {
      let entries;
      try {
        entries = await container.fs.readdir(dir, { withFileTypes: true });
      } catch {
        // Not a directory, or other error. Stop recursion.
        return;
      }

      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith(".")) {
          continue;
        }
        const fullPath = dir === "." ? entry.name : `${dir}/${entry.name}`;

        // Skip if this path matches gitignore patterns
        if (shouldIgnore(fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await readDirRecursive(fullPath);
        } else if (entry.isFile()) {
          // Test the full path against the pattern, not just the filename
          if (re.test(fullPath)) {
            allFiles.push(fullPath);
          }
        }
      }
    };

    await readDirRecursive(basePath);
    return allFiles;
  }

  static async runCommand(command: string, args: string[]): Promise<string> {
    const container = await this.getInstance();
    const process = await container.spawn(command, args);

    let output = "";
    const stream = new WritableStream({
      write(chunk) {
        output += chunk;
      },
    });

    process.output.pipeTo(stream);

    const exitCode = await process.exit;
    if (exitCode !== 0) {
      console.warn(
        `Command "${command} ${args.join(" ")}" exited with code ${exitCode}`
      );
    }

    return output;
  }

  static async grepSearch(
    pattern: string,
    options: {
      includeLineNumbers?: boolean;
      caseSensitive?: boolean;
      wholeWords?: boolean;
      filePattern?: string;
      maxResults?: number;
    } = {}
  ): Promise<string> {
    const {
      includeLineNumbers = true,
      caseSensitive = false,
      wholeWords = false,
      filePattern = "*",
      maxResults = 100,
    } = options;

    // Build grep command arguments
    const grepArgs: string[] = [];

    // Recursive search
    grepArgs.push("-r");

    // Include line numbers by default
    if (includeLineNumbers) {
      grepArgs.push("-n");
    }

    // Case sensitivity
    if (!caseSensitive) {
      grepArgs.push("-i");
    }

    // Whole words only
    if (wholeWords) {
      grepArgs.push("-w");
    }

    // Include filename
    grepArgs.push("-H");

    // Exclude common directories that should be ignored
    const excludeDirs = [
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "coverage",
      ".nyc_output",
      ".cache",
      "tmp",
      "temp",
    ];

    for (const dir of excludeDirs) {
      grepArgs.push("--exclude-dir=" + dir);
    }

    // Exclude common file types that shouldn't be searched
    const excludeFiles = [
      "*.log",
      "*.map",
      "*.min.js",
      "*.min.css",
      "*.png",
      "*.jpg",
      "*.jpeg",
      "*.gif",
      "*.svg",
      "*.ico",
      "*.woff*",
      "*.ttf",
      "*.eot",
      "*.zip",
      "*.tar",
      "*.gz",
    ];

    for (const file of excludeFiles) {
      grepArgs.push("--exclude=" + file);
    }

    // Add the search pattern
    grepArgs.push(pattern);

    // Add file pattern if specified and not default
    if (filePattern !== "*") {
      grepArgs.push("--include=" + filePattern);
    }

    // Search from current directory
    grepArgs.push(".");

    try {
      let output = await this.runCommand("grep", grepArgs);

      // Limit results if specified
      if (maxResults > 0) {
        const lines = output.split("\n").filter((line) => line.trim());
        if (lines.length > maxResults) {
          const truncatedLines = lines.slice(0, maxResults);
          output =
            truncatedLines.join("\n") +
            `\n\n... (truncated at ${maxResults} results, ${
              lines.length - maxResults
            } more matches found)`;
        }
      }

      return output;
    } catch {
      // If grep fails (e.g., no matches), return empty result
      return "No matches found.";
    }
  }

  static async runCommandWithEnv(
    command: string,
    args: string[],
    env: Record<string, string> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ process: any; exitCode: Promise<number> }> {
    const container = await this.getInstance();
    const spawnedProcess = await container.spawn(command, args, {
      env: {
        ...env,
      },
    });

    return {
      process: spawnedProcess,
      exitCode: spawnedProcess.exit,
    };
  }
}

export default WebContainerManager;
