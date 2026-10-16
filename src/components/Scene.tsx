import { domAnimation, LazyMotion, m, useIsPresent } from "motion/react";
import type { ReactNode } from "react";
import { useReducedMotion } from "../services";
export function Scene({
  children,
  inert = false,
}: {
  children: ReactNode;
  inert?: boolean;
}) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return (
    <div
      className="page-stage"
      inert={inert || !present}
      aria-hidden={inert || !present || undefined}
    >
      <LazyMotion features={domAnimation} strict>
        <m.div
          className="scene"
          inert={!present}
          initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{
            opacity: reduced ? 1 : 0,
            x: reduced ? 0 : -12,
            transition: { duration: reduced ? 0 : 0.1 },
          }}
          transition={{
            duration: reduced ? 0 : 0.22,
            ease: [0.2, 0.8, 0.2, 1],
          }}
        >
          {children}
        </m.div>
      </LazyMotion>
    </div>
  );
}
