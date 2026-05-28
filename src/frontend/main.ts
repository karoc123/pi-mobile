import "diff2html/bundles/css/diff2html.min.css";

import { mount } from "svelte";

import App from "./App.svelte";
import "./styles.css";

const app = mount(App, {
  target: document.getElementById("app") ?? document.body,
});

export default app;
