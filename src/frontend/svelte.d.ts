declare module '*.svelte' {
  import type { Component } from 'svelte';

  const component: Component;
  export default component;
}

declare module '*.css' {
  // Allow both side-effect imports (import "./styles.css") and default imports.
  const content: string;
  export default content;
}
