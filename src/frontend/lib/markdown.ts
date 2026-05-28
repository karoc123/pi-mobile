import DOMPurify from "dompurify";
import { marked } from "marked";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(input: string) {
  return DOMPurify.sanitize(marked.parse(input) as string);
}
