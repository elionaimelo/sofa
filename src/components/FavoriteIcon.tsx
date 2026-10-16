import { HeartIcon } from "@phosphor-icons/react";
import { gsap } from "gsap";
import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "../services";

/** A single pulse on a real change, including the controller's X shortcut. */
export function FavoriteIcon({ active }: { active: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const previous = useRef(active);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const changed = previous.current !== active;
    previous.current = active;
    if (!changed || reduced) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        "svg",
        { scale: active ? 0.72 : 1.12 },
        {
          scale: 1,
          duration: 0.48,
          ease: active ? "back.out(3)" : "power2.out",
        },
      );
      if (active)
        gsap.fromTo(
          ".favorite-halo",
          { scale: 0.6, opacity: 0.8 },
          { scale: 2.2, opacity: 0, duration: 0.55, ease: "power2.out" },
        );
    }, root);
    return () => context.revert();
  }, [active, reduced]);
  return (
    <span ref={root} className="favorite-icon" data-active={active} aria-hidden>
      <HeartIcon weight={active ? "fill" : "regular"} />
      <span className="favorite-halo" />
    </span>
  );
}
