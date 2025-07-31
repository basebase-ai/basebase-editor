import { WebContainer } from "@webcontainer/api";

class WebContainerManager {
  private static container: WebContainer | null = null;

  static async getInstance(): Promise<WebContainer> {
    // If we already have a booted instance, return it immediately.
    if (this.container) {
      console.log("WebContainer instance already exists");
      return this.container;
    }

    console.log("=== WebContainer Boot Debug ===");
    console.log("Location:", window.location.href);
    console.log("Origin:", window.location.origin);
    console.log("Hostname:", window.location.hostname);
    console.log("Protocol:", window.location.protocol);
    console.log(
      "Is localhost:",
      window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
    );
    console.log(
      "Domain type:",
      window.location.hostname.includes("localhost")
        ? "Development"
        : "Production"
    );
    console.log("Cross-origin isolated:", self.crossOriginIsolated);
    console.log(
      "SharedArrayBuffer available:",
      typeof SharedArrayBuffer !== "undefined"
    );
    console.log("Environment mode:", import.meta.env.MODE);
    console.log("User Agent:", navigator.userAgent);

    // Monitor fetch requests to see what WebContainer is trying to load
    const originalFetch = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      console.log("🔍 WebContainer fetch request:", url);

      try {
        const response = await originalFetch(input, init);
        if (!response.ok) {
          console.error(
            `❌ WebContainer fetch failed: ${url} - Status: ${response.status}`
          );
          console.error(
            "Response headers:",
            Object.fromEntries(response.headers.entries())
          );

          // Try to log response body for debugging
          const responseClone = response.clone();
          try {
            const text = await responseClone.text();
            console.error(
              "Response body (first 500 chars):",
              text.substring(0, 500)
            );
          } catch (e) {
            console.error("Could not read response body:", e);
          }
        } else {
          console.log(
            `✅ WebContainer fetch success: ${url} - Status: ${response.status}`
          );
        }
        return response;
      } catch (error) {
        console.error(`❌ WebContainer fetch error: ${url}`, error);
        throw error;
      }
    };

    try {
      console.log("Starting WebContainer.boot()...");
      this.container = await WebContainer.boot();
      console.log(
        "✅ WebContainer instance booted successfully",
        this.container
      );

      // Restore original fetch
      window.fetch = originalFetch;

      return this.container;
    } catch (error) {
      // Restore original fetch even on error
      window.fetch = originalFetch;

      console.error("❌ WebContainer boot failed:", error);
      throw error;
    }
  }

  static teardown(): void {
    if (this.container) {
      // WebContainer doesn't have a public teardown method
      // Just clear our reference to allow for a new instance if needed.
      this.container = null;
      console.log("WebContainer instance cleared");
    }
  }

  static hasInstance(): boolean {
    return this.container !== null;
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
      filePattern = "**/*",
      maxResults = 100,
    } = options;

    try {
      // Since grep might not be available in WebContainer, implement a JavaScript-based search
      const container = await this.getInstance();
      const files = await this.listFiles(filePattern, ".", false);

      console.log(
        `[grepSearch] Searching for "${pattern}" with options:`,
        options
      );
      console.log(
        `[grepSearch] Found ${files.length} files to search:`,
        files.slice(0, 10)
      ); // Show first 10 files

      const results: string[] = [];
      const regexFlags = caseSensitive ? "g" : "gi";
      const searchRegex = wholeWords
        ? new RegExp(
            `\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            regexFlags
          )
        : new RegExp(
            pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            regexFlags
          );

      console.log(`[grepSearch] Using regex:`, searchRegex);

      for (const file of files) {
        try {
          const content = await container.fs.readFile(file, "utf-8");
          const lines = content.split("\n");

          let fileHasMatches = false;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (searchRegex.test(line)) {
              if (!fileHasMatches) {
                console.log(`[grepSearch] Found match in file: ${file}`);
                fileHasMatches = true;
              }
              const lineNumber = includeLineNumbers ? `${i + 1}:` : "";
              const result = `${file}:${lineNumber}${line.trim()}`;
              results.push(result);

              if (results.length >= maxResults) {
                break;
              }
            }
          }

          if (results.length >= maxResults) {
            break;
          }
        } catch (error) {
          console.log(`[grepSearch] Could not read file: ${file}`, error);
          // Skip files that can't be read
          continue;
        }
      }

      if (results.length === 0) {
        console.log(`[grepSearch] No matches found for pattern "${pattern}"`);
        return "No matches found.";
      }

      console.log(`[grepSearch] Found ${results.length} total matches`);

      let output = results.join("\n");

      if (results.length >= maxResults) {
        output += `\n\n... (truncated at ${maxResults} results)`;
      }

      return output;
    } catch (error) {
      console.error("Error in grepSearch:", error);
      return "Error performing search.";
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
