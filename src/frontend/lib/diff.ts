import { html as diffToHtml } from "diff2html";

export function renderDiff(diff: string) {
  return diffToHtml(diff, {
    drawFileList: false,
    matching: "none",
    outputFormat: "line-by-line",
  });
}
