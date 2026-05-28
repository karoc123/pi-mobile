<script lang="ts">
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';
  import { markdown } from '@codemirror/lang-markdown';
  import { basicSetup } from 'codemirror';
  import { createEventDispatcher, onMount } from 'svelte';

  export let value = '';
  export let filePath = '';
  export let readOnly = false;

  const dispatch = createEventDispatcher<{ change: { value: string } }>();

  const languageCompartment = new Compartment();
  const editableCompartment = new Compartment();
  let host: HTMLDivElement;
  let view: EditorView | null = null;

  onMount(() => {
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
              dispatch('change', { value: update.state.doc.toString() });
            }
          })
        ]
      })
    });

    return () => {
      view?.destroy();
    };
  });

  $: if (view && value !== view.state.doc.toString()) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    });
  }

  $: if (view) {
    view.dispatch({ effects: languageCompartment.reconfigure(languageFor(filePath)) });
    view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)) });
  }

  function languageFor(pathValue: string) {
    if (pathValue.endsWith('.json')) {
      return json();
    }

    if (pathValue.endsWith('.md')) {
      return markdown();
    }

    if (pathValue.endsWith('.ts') || pathValue.endsWith('.tsx') || pathValue.endsWith('.js') || pathValue.endsWith('.svelte')) {
      return javascript({ typescript: pathValue.endsWith('.ts') || pathValue.endsWith('.tsx') });
    }

    return [];
  }
</script>

<div class="editor-host" bind:this={host}></div>