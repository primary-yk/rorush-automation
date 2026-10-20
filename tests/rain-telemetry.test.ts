import { describe, expect, it } from "vitest";
import {
  formatRainJoinSummary,
  rainTelemetryAccountJoined,
  rainTelemetryCaptchaReady,
  rainTelemetryGet,
  rainTelemetryJoinAttempt,
  rainTelemetryOnCreated,
} from "../src/automation/rain-telemetry.js";

describe("rain telemetry summary", () => {
  it("formats join summary line", () => {
    rainTelemetryOnCreated({ rainId: "abc-123-unique-test", amount: 500 });
    rainTelemetryCaptchaReady("abc-123-unique-test", 183);
    rainTelemetryJoinAttempt("abc-123-unique-test", ["vkevin"]);
    rainTelemetryAccountJoined("abc-123-unique-test", "vkevin");
    const row = rainTelemetryGet("abc-123-unique-test")!;
    expect(formatRainJoinSummary(row)).toMatch(/joined 1\/1/);
    expect(formatRainJoinSummary(row)).toMatch(/183s captcha/);
    expect(formatRainJoinSummary(row)).toMatch(/vkevin/);
  });
});
