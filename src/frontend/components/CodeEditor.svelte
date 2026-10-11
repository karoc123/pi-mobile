<script lang="ts">
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';
  import { markdown } from '@codemirror/lang-markdown';
  import { basicSetup } from 'codemirror';
  import { onMount } from 'svelte';

  interface Props {
    value?: string;
    filePath?: string;
    readOnly?: boolean;
    onchange?: (value: string) => void;
  }

  const { value = '', filePath = '', readOnly = false, onchange = () => {} }: Props = $props();

  const languageCompartment = new Compartment();
  const editableCompartment = new Compartment();
  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;

  onMount(() => {
    if (!host) return;

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          EditorView.lineWrapping,
          languageCompartment.of(languageFor(filePath)),
          editableCompartment.of(EditorView.editable.of(!readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onchange(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    return () => {
      view?.destroy();
    };
  });

  $effect(() => {
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  });

  $effect(() => {
    if (view) {
      view.dispatch({ effects: languageCompartment.reconfigure(languageFor(filePath)) });
      view.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)),
      });
    }
  });

  function languageFor(pathValue: string) {
    if (pathValue.endsWith('.json')) {
      return json();
    }

    if (pathValue.endsWith('.md')) {
      return markdown();
    }

    if (
      pathValue.endsWith('.ts') ||
      pathValue.endsWith('.tsx') ||
      pathValue.endsWith('.js') ||
      pathValue.endsWith('.svelte')
    ) {
      return javascript({ typescript: pathValue.endsWith('.ts') || pathValue.endsWith('.tsx') });
    }

    return [];
  }
</script>

<div class="editor-host" bind:this={host}></div>

<style>
  .editor-host {
    min-height: 56vh;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--line);
  }
</style>
