// @vitest-environment node

import path from "node:path";

import { describe, expect, it } from "vitest";

import { relativeFrom, resolveWithin, toPosixPath } from "./path-utils.js";

describe("path-utils", () => {
  const rootDir = path.resolve("/workspace/app");

  describe("resolveWithin", () => {
    it("resolves safe relative paths within root", () => {
      expect(resolveWithin(rootDir, "src/index.ts")).toBe(path.resolve(rootDir, "src/index.ts"));
      expect(resolveWithin(rootDir, "./package.json")).toBe(path.resolve(rootDir, "package.json"));
      expect(resolveWithin(rootDir, "")).toBe(rootDir);
      expect(resolveWithin(rootDir, "   ")).toBe(rootDir);
    });

    it("throws when path escapes workspace root with ..", () => {
      expect(() => resolveWithin(rootDir, "../outside")).toThrow("Path escapes the configured workspace root.");
      expect(() => resolveWithin(rootDir, "foo/../../outside")).toThrow("Path escapes the configured workspace root.");
    });
  });

  describe("toPosixPath", () => {
    it("normalizes path separators to forward slashes", () => {
      expect(toPosixPath("src/backend/app.ts")).toBe("src/backend/app.ts");
      expect(toPosixPath(["src", "backend", "app.ts"].join(path.sep))).toBe("src/backend/app.ts");
    });
  });

  describe("relativeFrom", () => {
    it("returns POSIX relative path from root", () => {
      expect(relativeFrom(rootDir, path.join(rootDir, "src", "index.ts"))).toBe("src/index.ts");
      expect(relativeFrom(rootDir, rootDir)).toBe(".");
    });
  });
});
