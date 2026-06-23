declare module "*.svelte" {
  import type { ComponentType } from "svelte";

  const component: ComponentType;
  export default component;
}

declare module "*.css" {
  // Allow both side-effect imports (import "./styles.css") and default imports.
  const content: string;
  export default content;
}
