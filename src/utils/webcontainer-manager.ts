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

    // Simple glob to regex for filename matching
    const globToRegex = (glob: string) => {
      const regexString = glob
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp(`^${regexString}$`);
    };
    const re = globToRegex(pattern);

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
        if (entry.isDirectory()) {
          await readDirRecursive(fullPath);
        } else if (entry.isFile()) {
          if (re.test(entry.name)) {
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
