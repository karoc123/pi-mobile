import { describe, expect, it } from "vitest";

import { renderDiff } from "./diff.js";

describe("renderDiff", () => {
  const sampleDiff = `diff --git a/file.txt b/file.txt
index e69de29..49b93be 100644
--- a/file.txt
+++ b/file.txt
@@ -0,0 +1 @@
+hello world
`;

  it("renders line-by-line diff HTML from git patch", () => {
    const html = renderDiff(sampleDiff);

    expect(html).toContain("d2h-wrapper");
    expect(html).toContain("hello world");
    expect(html).toContain("d2h-ins");
  });

  it("handles empty diff string gracefully", () => {
    const html = renderDiff("");
    expect(typeof html).toBe("string");
  });
});
