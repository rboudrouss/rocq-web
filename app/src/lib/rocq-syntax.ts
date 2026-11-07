// Rocq's syntax, roughly: comments, strings, vernacular keywords, tactics.
import { StreamLanguage, type StreamParser } from "@codemirror/language";

const vernac = new Set(
  ("Theorem Lemma Remark Fact Corollary Proposition Definition Fixpoint CoFixpoint Inductive CoInductive " +
    "Record Structure Class Instance Example Let Variable Variables Hypothesis Hypotheses Axiom Parameter " +
    "Notation Infix Section End Module Import Export Require From Open Close Scope Set Unset Check Print " +
    "Eval Compute Search About Locate Proof Qed Defined Admitted Abort Goal Ltac Ltac2 Arguments Implicit " +
    "Type Types Hint Declare Canonical Coercion Context Program Opaque Transparent Local Global").split(" "),
);
const keywords = new Set(
  "forall exists fun match with end as in return if then else let fix cofix struct Prop Set Type SProp".split(" "),
);
const tactics = new Set(
  ("intro intros apply exact refine rewrite simpl unfold induction destruct case elim split left right " +
    "exists reflexivity symmetry transitivity assumption auto eauto trivial lia ring field congruence " +
    "firstorder tauto inversion injection discriminate subst assert pose set remember generalize revert " +
    "clear specialize constructor econstructor eapply cbn cbv lazy vm_compute compute now by done move have").split(
    " ",
  ),
);

type State = { comment: number };

const parser: StreamParser<State> = {
  startState: () => ({ comment: 0 }),
  token(stream, state) {
    if (state.comment > 0) {
      while (!stream.eol()) {
        if (stream.match("(*")) state.comment++;
        else if (stream.match("*)")) {
          if (--state.comment === 0) break;
        } else stream.next();
      }
      return "comment";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("(*")) {
      state.comment = 1;
      return "comment";
    }
    if (stream.match(/^"([^"]|"")*"/)) return "string";
    if (stream.match(/^[0-9]+/)) return "number";
    const w = stream.match(/^[A-Za-z_][A-Za-z0-9_']*/) as RegExpMatchArray | null;
    if (w) {
      const word = w[0];
      if (vernac.has(word)) return "keyword";
      if (keywords.has(word)) return "keyword";
      if (tactics.has(word)) return "variableName.special";
      return null;
    }
    stream.next();
    return null;
  },
};

export const rocq = StreamLanguage.define(parser);
