<script lang="ts">
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { onMount } from 'svelte';
  import { toast } from '../lib/toast.svelte.js';

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
  let view = $state.raw<EditorView | null>(null);

  onMount(() => {
    if (!host) return;

    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          EditorView.lineWrapping,
          languageCompartment.of([]),
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
      view = null;
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
    const currentView = view;
    const path = filePath;
    if (!currentView) return;
    let cancelled = false;
    void languageFor(path)
      .then((language) => {
        if (!cancelled)
          currentView.dispatch({ effects: languageCompartment.reconfigure(language) });
      })
      .catch(() => {
        if (!cancelled) toast.show('Syntax highlighting could not be loaded.', 'error');
      });
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    view?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)) });
  });

  async function languageFor(pathValue: string) {
    if (pathValue.endsWith('.json')) {
      const { json } = await import('@codemirror/lang-json');
      return json();
    }

    if (pathValue.endsWith('.md')) {
      const { markdown } = await import('@codemirror/lang-markdown');
      return markdown();
    }

    if (
      pathValue.endsWith('.ts') ||
      pathValue.endsWith('.tsx') ||
      pathValue.endsWith('.js') ||
      pathValue.endsWith('.svelte')
    ) {
      const { javascript } = await import('@codemirror/lang-javascript');
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
