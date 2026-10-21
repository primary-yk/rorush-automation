import { describe, expect, it } from "vitest";
import { classifyHostIssue, groupHostLogEmbeds } from "../src/discord/host-log-classify.js";

describe("host-log-classify", () => {
  it("classifies captcha vs login vs join", () => {
    expect(classifyHostIssue("Rain captcha still waiting")).toBe("captcha");
    expect(classifyHostIssue("Session expired and re-login failed")).toBe("login");
    expect(classifyHostIssue("Rain join failed — wager")).toBe("join");
  });

  it("groups multiple host embeds", () => {
    const out = groupHostLogEmbeds([
      { title: "Rain · a", description: "join failed" },
      { title: "Rain · b", description: "captcha timeout" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.fields?.length).toBeGreaterThan(0);
  });
});
