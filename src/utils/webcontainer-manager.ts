import { WebContainer } from "@webcontainer/api";

class WebContainerManager {
  private static instance: WebContainer | null = null;
  private static isBooting: boolean = false;

  static async getInstance(): Promise<WebContainer> {
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
      this.instance = await WebContainer.boot();
      this.isBooting = false;
      return this.instance;
    } catch (error) {
      this.isBooting = false;
      throw error;
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
