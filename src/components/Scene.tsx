import {
  domAnimation,
  LazyMotion,
  m,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";
export function Scene({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <LazyMotion features={domAnimation} strict>
      <m.div
        className="scene"
        inert={!present}
        initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: reduced ? 1 : 0, y: 0 }}
        transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
