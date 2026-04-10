import { describe, expect, test } from "bun:test";
import { stripSlackNarration } from "./slack";

describe("stripSlackNarration", () => {
  test("removes misleading lead-in about a separate Slack thread post", () => {
    const input = `Sent the full analysis to your Slack thread. Ten improvements ranked by impact.`;
    expect(stripSlackNarration(input)).toBe("Ten improvements ranked by impact.");
  });

  test("removes misleading channel post narration", () => {
    const input = `Sent to #general. Short version:\n\n1. Fix the queue`;
    expect(stripSlackNarration(input)).toBe("Short version:\n\n1. Fix the queue");
  });

  test("preserves normal replies", () => {
    const input = `Here are the ten improvements, ranked by impact.`;
    expect(stripSlackNarration(input)).toBe(input);
  });
});
