import { gsap } from "gsap";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "../services";

/** A visible camera move that eases to a stop instead of looping behind the controls. */
function CameraArt({ src }: { src: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    if (reduced) return;
    const context = gsap.context(() => {
      gsap.fromTo(
        ref.current,
        { scale: 1.22, xPercent: 3, yPercent: 1.5 },
        {
          scale: 1.06,
          xPercent: -1,
          yPercent: -0.5,
          duration: 4.8,
          ease: "power2.out",
        },
      );
    });
    return () => context.revert();
  }, [reduced]);
  return (
    <img
      ref={ref}
      className="backdrop-art"
      src={src}
      alt=""
      width={1920}
      height={1080}
    />
  );
}

/** Keep the previous art on screen until its replacement can actually be painted. */
export function GameBackdrop({
  src,
  previous,
  next,
  children,
}: {
  src: string | undefined;
  previous: string | undefined;
  next: string | undefined;
  children?: ReactNode;
}) {
  const [ready, setReady] = useState<string>();
  const reduced = useReducedMotion();
  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setReady(undefined);
      return;
    }
    const image = new Image();
    image.src = src;
    void image.decode().then(
      () => {
        if (!cancelled) setReady(src);
      },
      () => {
        if (!cancelled) setReady(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [src]);
  // Let a quick run through the row finish before warming the two adjacent games.
  useEffect(() => {
    if (!src) return;
    const timer = setTimeout(() => {
      for (const url of new Set([previous, next])) {
        if (!url || url === src) continue;
        const image = new Image();
        image.src = url;
        void image.decode().catch(() => undefined);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [src, previous, next]);

  return (
    <LazyMotion features={domAnimation} strict>
      <div className="backdrop" aria-hidden>
        <AnimatePresence custom={Boolean(ready)}>
          {ready && (
            <m.div
              key={ready}
              className="backdrop-layer"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              variants={{
                leaving: (replacing: boolean) => ({
                  opacity: 0,
                  // Keep the outgoing art opaque until its replacement covers it.
                  transition: {
                    delay: replacing && !reduced ? 0.26 : 0,
                    duration: replacing || reduced ? 0 : 0.26,
                  },
                }),
              }}
              exit="leaving"
              transition={{ duration: reduced ? 0 : 0.26, ease: "easeOut" }}
            >
              <CameraArt src={ready} />
            </m.div>
          )}
        </AnimatePresence>
        {children}
      </div>
    </LazyMotion>
  );
}
