// A phone: the page in a narrow window (the mobile layout), and its
// on-screen keyboard
import { useEffect, useState } from "react";

// The window as narrow as a phone's, held up
const narrow = "(max-width: 760px)";

export function useMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(narrow).matches);
  useEffect(() => {
    const m = window.matchMedia(narrow);
    const change = () => setMobile(m.matches);
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  return mobile;
}

// The keyboard open: the editor focused and the part of the page shown (the
// visual viewport) much lower than it was at that width. The page's height
// (--vvh) and top (--vvtop) follow that part: iOS Safari does not resize the
// page under its keyboard (nor Chrome without interactive-widget, in
// index.html), it scrolls it.
export function useKeyboard(on: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement.style;
    if (!on || !vv) return;
    // the highest seen at this width (the keyboard closed)
    let width = 0;
    let tallest = 0;
    const update = () => {
      if (vv.width !== width) [width, tallest] = [vv.width, 0];
      tallest = Math.max(tallest, vv.height);
      root.setProperty("--vvh", `${vv.height}px`);
      root.setProperty("--vvtop", `${vv.offsetTop}px`);
      const editing = !!document.activeElement?.closest(".editor .cm-content");
      setOpen(editing && vv.height < tallest * 0.8);
    };
    // (the element focused once the focus moved)
    const later = () => window.setTimeout(update);
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", later);
    document.addEventListener("focusout", later);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", later);
      document.removeEventListener("focusout", later);
      root.removeProperty("--vvh");
      root.removeProperty("--vvtop");
      setOpen(false);
    };
  }, [on]);
  return open;
}
