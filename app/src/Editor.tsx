// CodeMirror: the document, its diagnostics, and the part being checked.
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { type Diagnostic as CmDiagnostic, lintGutter, setDiagnostics } from "@codemirror/lint";
import { EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, EditorView, highlightActiveLine, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CompletionItem, Diagnostic, Hover, Position, Range } from "./lsp";
import { oneDark } from "@codemirror/theme-one-dark";
import { rocq } from "./rocq-syntax";

// the system's dark mode, when the editor is created
const dark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches;

export type EditorHandle = {
  setDiagnostics: (d: Diagnostic[]) => void;
  setProcessing: (r: Range[]) => void;
  // Selects a range (its start when [r] is a position) and shows it
  goTo: (r: Range | Position) => void;
  // Inserts a line before the cursor's
  insertLine: (text: string) => void;
};

type Props = {
  initial: string;
  // the range selected and shown when the editor is created
  at?: Range;
  readOnly?: boolean;
  onChange?: (text: string) => void;
  onCursor?: (p: Position) => void;
  hover?: (p: Position) => Promise<Hover | null>;
  complete?: (p: Position) => Promise<CompletionItem[]>;
  // F12 or Ctrl+click
  definition?: (p: Position) => void;
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

const position = (doc: Text, pos: number): Position => {
  const line = doc.lineAt(pos);
  return { line: line.number - 1, character: pos - line.from };
};

const severities = ["error", "error", "warning", "info", "hint"] as const;

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  // coq-lsp's completions: identifiers, and after a backslash unicode
  // symbols (\to), with their edit
  const complete = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/\\?[A-Za-z0-9_'.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    // coq-lsp gives unicode symbols at the position following the backslash
    const at = ctx.state.doc.sliceString(word.from, word.from + 1) === "\\" ? word.from + 1 : ctx.pos;
    const items = (await callbacks.current.complete?.(position(ctx.state.doc, at))) ?? [];
    if (items.length === 0) return null;
    return {
      from: word.from,
      options: items.map((i) => ({
        label: i.label,
        detail: i.labelDetails?.detail,
        apply: i.textEdit?.newText ?? i.insertText ?? i.label,
      })),
    };
  };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: callbacks.current.initial,
        extensions: [
          lineNumbers(),
          history(),
          highlightActiveLine(),
          keymap.of([
            {
              key: "F12",
              run: (v) => {
                callbacks.current.definition?.(position(v.state.doc, v.state.selection.main.head));
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            mousedown: (e, v) => {
              if (!(e.ctrlKey || e.metaKey) || !callbacks.current.definition) return false;
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos == null) return false;
              callbacks.current.definition(position(v.state.doc, pos));
              e.preventDefault();
              return true;
            },
          }),
          EditorState.readOnly.of(!!callbacks.current.readOnly),
          dark() ? oneDark : syntaxHighlighting(defaultHighlightStyle),
          rocq,
          lintGutter(),
          processing,
          autocompletion({ override: [complete] }),
          hoverTooltip(async (v, pos) => {
            const h = await callbacks.current.hover?.(position(v.state.doc, pos));
            if (!h) return null;
            const text = typeof h.contents === "string" ? h.contents : h.contents.value;
            if (!text.trim()) return null;
            return {
              pos,
              create: () => {
                const dom = document.createElement("pre");
                dom.className = "hover";
                dom.textContent = text.replace(/```\w*\n?/g, "");
                return { dom };
              },
            };
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange?.(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              callbacks.current.onCursor?.(position(u.state.doc, u.state.selection.main.head));
            }
          }),
        ],
      }),
    });
    view.current = v;
    const at = callbacks.current.at;
    if (at) {
      const from = offset(v.state.doc, at.start);
      v.dispatch({
        selection: { anchor: from, head: offset(v.state.doc, at.end) },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
    }
    // for tests (tests/*.mjs)
    if (!callbacks.current.readOnly) (window as unknown as { rocqView: EditorView }).rocqView = v;
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
    goTo(r) {
      const v = view.current;
      if (!v) return;
      const range = "start" in r ? r : { start: r, end: r };
      const from = offset(v.state.doc, range.start);
      const to = offset(v.state.doc, range.end);
      v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
      v.focus();
    },
    insertLine(text) {
      const v = view.current;
      if (!v) return;
      const line = v.state.doc.lineAt(v.state.selection.main.head);
      v.dispatch({ changes: { from: line.from, insert: text + "\n" } });
      v.focus();
    },
  }));

  return <div className="editor" ref={host} />;
});
