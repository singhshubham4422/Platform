// Bundles Monaco locally (no CDN: the desktop CSP only allows 'self') with just the editor core,
// the Python/C/C++/Java grammars and the generic editor worker.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';
import type { LanguageId } from '@platform/language-config';
import { getLanguage } from '@platform/language-config';
import { completionsFor, type CompletionKind } from '../lib/language-completions';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

loader.config({ monaco });

const KIND: Record<CompletionKind, monaco.languages.CompletionItemKind> = {
  function: monaco.languages.CompletionItemKind.Function,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  snippet: monaco.languages.CompletionItemKind.Snippet,
  property: monaco.languages.CompletionItemKind.Property,
  class: monaco.languages.CompletionItemKind.Class,
};

let registered = false;

/** Register language-specific completions once per app session. */
export function registerCompletions(): void {
  if (registered) return;
  registered = true;
  for (const id of ['PYTHON', 'C', 'CPP', 'JAVA'] as LanguageId[]) {
    const monacoId = getLanguage(id)!.monaco;
    monaco.languages.registerCompletionItemProvider(monacoId, {
      triggerCharacters: id === 'PYTHON' ? ['.'] : [],
      provideCompletionItems(model, position) {
        // C and C++ share Monaco's cpp grammar; pick entries from the model's tagged language.
        const lang = ((model as unknown as { __lpLanguage?: LanguageId }).__lpLanguage ?? id) as LanguageId;
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const prefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        return {
          suggestions: completionsFor(lang, prefix).map((c) => ({
            label: c.label,
            kind: KIND[c.kind],
            insertText: c.insert,
            insertTextRules: c.insert.includes('$') ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            detail: c.detail,
            documentation: c.doc,
            range,
          })),
        };
      },
    });
  }
}

export { monaco };
