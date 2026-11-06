// CodeMirror: the document, its diagnostics, and the part being checked.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Diagnostic, Position, Range } from "./lsp";
import { rocq } from "./rocq-syntax";

export type EditorHandle = {
  setDiagnostics: (d: Diagnostic[]) => void;
  setProcessing: (r: Range[]) => void;
};

type Props = {
  initial: string;
  onChange: (text: string) => void;
  onCursor: (p: Position) => void;
};

const offset = (doc: Text, p: Position) => {
  const line = doc.line(Math.min(p.line + 1, doc.lines));
  return Math.min(line.from + p.character, line.to);
};

// The text not checked yet
const setProcessingEffect = StateEffect.define<Range[]>();
const processing = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects)
      if (e.is(setProcessingEffect)) {
        const doc = tr.state.doc;
        deco = Decoration.set(
          e.value
            .map((r) => [offset(doc, r.start), offset(doc, r.end)])
            .filter(([a, b]) => a < b)
            .map(([a, b]) => Decoration.mark({ class: "cm-processing" }).range(a, b)),
          true,
        );
      }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const severities = ["error", "error", "warning", "info", "hint"] as const;

export const Editor = forwardRef<EditorHandle, Props>(function Editor({ initial, onChange, onCursor }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onCursor });
  callbacks.current = { onChange, onCursor };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(defaultHighlightStyle),
          rocq,
          lintGutter(),
          processing,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              callbacks.current.onCursor({ line: line.number - 1, character: head - line.from });
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // the initial text only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    setDiagnostics(ds) {
      const v = view.current;
      if (!v) return;
      const doc = v.state.doc;
      const cm: CmDiagnostic[] = ds.map((d) => ({
        from: offset(doc, d.range.start),
        to: Math.max(offset(doc, d.range.end), offset(doc, d.range.start)),
        severity: severities[d.severity] ?? "info",
        message: d.message,
      }));
      v.dispatch(setDiagnostics(v.state, cm));
    },
    setProcessing(rs) {
      view.current?.dispatch({ effects: setProcessingEffect.of(rs) });
    },
  }));

  return <div className="editor" ref={host} />;
});
