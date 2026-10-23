import { describe, expect, it } from "vitest";
import { parseCaptchaApiBody } from "../src/captcha/parse-body.js";

describe("parseCaptchaApiBody", () => {
  it("parses plain JSON", () => {
    expect(parseCaptchaApiBody('{"errorId":0,"balance":1.5}', "test")).toEqual({
      errorId: 0,
      balance: 1.5,
    });
  });

  it("strips leading status junk before JSON", () => {
    expect(
      parseCaptchaApiBody('200 {"errorId":0,"status":"processing"}', "test"),
    ).toEqual({ errorId: 0, status: "processing" });
  });

  it("throws with preview on garbage", () => {
    expect(() => parseCaptchaApiBody("<html>blocked</html>", "test")).toThrow(/non-JSON/);
  });
});
