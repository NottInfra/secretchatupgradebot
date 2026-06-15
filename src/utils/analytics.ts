import { recordAnalyticsEvent } from "./telemetry.js";

export class Analytics {
  trackEvent(name: string, props: Record<string, unknown>): void {
    recordAnalyticsEvent(name, props);
  }
}
