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
}

export default WebContainerManager;
