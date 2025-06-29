import { WebContainer } from "@webcontainer/api";

class WebContainerManager {
  private static instance: WebContainer | null = null;
  private static isBooting: boolean = false;

  static async getInstance(): Promise<WebContainer> {
    // Check cross-origin isolation first
    if (!self.crossOriginIsolated) {
      throw new Error(
        "WebContainer requires cross-origin isolation. " +
          "Please ensure your page is served with proper COOP and COEP headers. " +
          `Current crossOriginIsolated status: ${self.crossOriginIsolated}`
      );
    }

    // If already booting, wait for it to complete
    if (this.isBooting) {
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.isBooting && this.instance) {
            clearInterval(checkInterval);
            resolve(this.instance);
          }
        }, 100);

        // Timeout after 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          reject(new Error("WebContainer boot timeout"));
        }, 30000);
      });
    }

    // If instance exists, return it
    if (this.instance) {
      return this.instance;
    }

    // Boot new instance
    try {
      this.isBooting = true;
      console.log(
        "Booting WebContainer with crossOriginIsolated:",
        self.crossOriginIsolated
      );

      // Try credentialless mode for better deployment compatibility
      this.instance = await WebContainer.boot({ coep: "credentialless" });
      this.isBooting = false;
      console.log("WebContainer booted successfully in credentialless mode");
      return this.instance;
    } catch (error) {
      this.isBooting = false;
      console.error("WebContainer boot failed:", error);

      // Fallback to default mode if credentialless fails
      try {
        console.log("Retrying WebContainer boot in default mode...");
        this.isBooting = true;
        this.instance = await WebContainer.boot();
        this.isBooting = false;
        console.log("WebContainer booted successfully in default mode");
        return this.instance;
      } catch (fallbackError) {
        this.isBooting = false;
        console.error("WebContainer fallback boot also failed:", fallbackError);
        throw fallbackError;
      }
    }
  }

  static async teardown(): Promise<void> {
    if (this.instance) {
      this.instance.teardown();
      this.instance = null;
    }
    this.isBooting = false;
  }

  static hasInstance(): boolean {
    return this.instance !== null;
  }
}

export default WebContainerManager;
