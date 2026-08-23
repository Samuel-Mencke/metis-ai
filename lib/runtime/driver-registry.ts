import type { ProviderDriver, DriverExecutionContext, DriverExecutionResult } from "./drivers/base-driver";
import { ClaudeDriver } from "./drivers/claude-driver";
import { CodexDriver } from "./drivers/codex-driver";
import { CursorDriver } from "./drivers/cursor-driver";
import { AntigravityDriver } from "./drivers/antigravity-driver";
import { OpenCodeDriver } from "./drivers/opencode-driver";
import { GrokDriver } from "./drivers/grok-driver";
import { AiSdkDriver } from "./drivers/ai-sdk-driver";

class DriverRegistry {
  private drivers = new Map<string, ProviderDriver>();
  private defaultDriver: ProviderDriver;

  constructor() {
    const aiSdk = new AiSdkDriver();
    this.defaultDriver = aiSdk;

    this.register(new ClaudeDriver());
    this.register(new CodexDriver());
    this.register(new CursorDriver());
    this.register(new AntigravityDriver());
    this.register(new OpenCodeDriver());
    this.register(new GrokDriver());
    this.register(aiSdk);
  }

  public register(driver: ProviderDriver): void {
    this.drivers.set(driver.key, driver);
  }

  public getDriver(providerKey: string): ProviderDriver {
    return this.drivers.get(providerKey) || this.defaultDriver;
  }

  public async execute(providerKey: string, context: DriverExecutionContext): Promise<DriverExecutionResult> {
    const driver = this.getDriver(providerKey);
    return driver.execute(context);
  }
}

export const driverRegistry = new DriverRegistry();
