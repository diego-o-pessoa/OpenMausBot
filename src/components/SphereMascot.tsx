import React, { useEffect, useId, useMemo, useRef } from "react";

import type { CursorAvatarHandle, CursorSilhouette } from "./CursorAvatar";
import { FACE_BOX } from "./cursor-face-data";
import { mascotClock, usePrefersReducedMotion, type MascotTicket } from "./mascot-clock";
import { FULL_FRAME_MS, VIEW_SPAN } from "./mascot-motion";
import { DONE_TRACK, PRESS_TRACK, WORKING_TRACK } from "./mascot-tracks";
import {
  BLINK_MS,
  HOVER_FACE,
  IDLE_FACE,
  SMILE_STROKE,
  STILL_WORKING_FACE,
  blinkOpenness,
  eyeOpacity,
  faceDistance,
  lookToward,
  mixFace,
  pillPath,
  smilePath,
  trackDurationMs,
  trackFaceAt,
  type Face,
  type MascotMood,
} from "./sphere-mascot";

const VIEW_BOX = `-15 -15 ${VIEW_SPAN} ${VIEW_SPAN}`;
const BODY_RADIUS = FACE_BOX / 2;
const CIRCLE_ANCHOR_OFFSET: [number, number] = [0.45, 4];
const EASE_SECONDS = 0.06;
const DONE_MS = trackDurationMs(DONE_TRACK, false);
const PRESS_MS = trackDurationMs(PRESS_TRACK, false);

export interface SphereMascotProps {
  mood?: MascotMood;
  /** Holds one face, for previews and tests. */
  face?: Face;
  size?: number | string;
  fill: string;
  silhouette: CursorSilhouette;
  paused?: boolean;
  interactive?: boolean;
  eyeColor?: string;
  title?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export interface SphereMascotHandle extends CursorAvatarHandle {
  celebrate: () => void;
}

export const SphereMascot = React.forwardRef<SphereMascotHandle, SphereMascotProps>(function SphereMascot(
  { mood = "idle", face, size = 160, fill, silhouette, paused = false, interactive = true, eyeColor = "#ffffff", title, className, style },
  ref,
) {
  const reactId = useId();
  const uid = useMemo(() => "sphere" + reactId.replace(/[^a-zA-Z0-9]/g, ""), [reactId]);
  const svg = useRef<SVGSVGElement | null>(null);
  const bodyGroup = useRef<SVGGElement | null>(null);
  const pills = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const smiles = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const ticket = useRef<MascotTicket | null>(null);
  const reduced = usePrefersReducedMotion();
  const sizePx = typeof size === "number" ? size : 160;
  const centre: [number, number] = [silhouette.anchor.x + CIRCLE_ANCHOR_OFFSET[0], silhouette.anchor.y + CIRCLE_ANCHOR_OFFSET[1]];

  const engine = useRef({
    props: { mood, pinned: face, paused, reduced, interactive, sizePx, centre },
    face: face ?? (mood === "working" ? STILL_WORKING_FACE : IDLE_FACE),
    workStart: 0,
    doneStart: null as number | null,
    pressStart: null as number | null,
    blinkStart: null as number | null,
    hover: false,
    pointer: [0, 0] as [number, number],
    lastMood: mood,
    last: 0,
    drawn: "",
  });
  engine.current.props = { mood, pinned: face, paused, reduced, interactive, sizePx, centre };
  const wake = () => ticket.current?.wake();

  React.useImperativeHandle(
    ref,
    () => ({
      blink: () => {
        if (engine.current.props.reduced) return;
        engine.current.blinkStart = performance.now();
        wake();
      },
      spin: () => {
        if (engine.current.props.reduced) return;
        engine.current.pressStart = performance.now();
        wake();
      },
      setExpression: () => {},
      celebrate: () => {
        if (engine.current.props.reduced) return;
        engine.current.doneStart = performance.now();
        wake();
      },
    }),
    [],
  );

  useEffect(() => {
    const e = engine.current;
    const now = performance.now();
    if (e.lastMood === "working" && mood !== "working" && !reduced) e.doneStart = now;
    if (mood === "working" && e.lastMood !== "working") {
      e.workStart = now;
      e.doneStart = null;
    }
    e.lastMood = mood;
    e.drawn = "";
    wake();
  }, [mood, face, paused, reduced, interactive, sizePx, silhouette]);

  useEffect(() => {
    const targetFace = (now: number): { face: Face; moving: boolean } => {
      const e = engine.current;
      const p = e.props;
      if (p.pinned) return { face: p.pinned, moving: false };
      if (e.pressStart !== null) {
        if (now - e.pressStart < PRESS_MS) return { face: trackFaceAt(PRESS_TRACK, now - e.pressStart, false), moving: true };
        e.pressStart = null;
      }
      if (e.doneStart !== null) {
        if (now - e.doneStart < DONE_MS) return { face: trackFaceAt(DONE_TRACK, now - e.doneStart, false), moving: true };
        e.doneStart = null;
      }
      if (e.hover && p.interactive) return { face: lookToward(HOVER_FACE, e.pointer[0], e.pointer[1]), moving: false };
      if (p.mood !== "working") return { face: IDLE_FACE, moving: false };
      if (p.paused || p.reduced) return { face: STILL_WORKING_FACE, moving: false };
      return { face: trackFaceAt(WORKING_TRACK, now - e.workStart, true), moving: true };
    };

    const frame = (now: number): number => {
      const e = engine.current;
      const p = e.props;
      const dt = Math.min(Math.max(now - (e.last || now), 0), 50) / 1000;
      e.last = now;
      const target = targetFace(now);
      e.face = p.reduced || p.pinned ? target.face : mixFace(e.face, target.face, 1 - Math.exp(-dt / EASE_SECONDS));
      const settled = faceDistance(e.face, target.face) < 0.002;
      if (settled) e.face = target.face;

      let open = 1;
      if (e.blinkStart !== null) {
        open = blinkOpenness(now - e.blinkStart);
        if (now - e.blinkStart >= BLINK_MS) e.blinkStart = null;
      }

      const f = e.face;
      const [cx, cy] = p.centre;
      const sx = f.scale * f.stretchX;
      const sy = f.scale * f.stretchY;
      const bodyTransform =
        Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4
          ? ""
          : `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
      const placed = f.eyes.map((eye) => {
        const at = `translate(${(cx + eye.x * BODY_RADIUS).toFixed(2)} ${(cy - eye.y * BODY_RADIUS).toFixed(2)})`;
        return {
          pill: `${at} scale(1 ${open.toFixed(3)}) rotate(${eye.angle.toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          smile: `${at} rotate(${((((eye.angle + 90) % 180) + 180) % 180 - 90).toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          d: pillPath(eye.length, eye.width),
          opacity: eyeOpacity(eye),
        };
      });
      const drawn = `${bodyTransform}|${placed.map((q) => q.pill + q.d + q.opacity.toFixed(2)).join("|")}|${f.smile.toFixed(3)}`;
      if (drawn !== e.drawn) {
        e.drawn = drawn;
        if (bodyGroup.current) {
          if (bodyTransform) bodyGroup.current.setAttribute("transform", bodyTransform);
          else bodyGroup.current.removeAttribute("transform");
        }
        placed.forEach((q, i) => {
          const pillEl = pills[i].current;
          if (pillEl) {
            pillEl.setAttribute("d", q.d);
            pillEl.setAttribute("transform", q.pill);
            pillEl.style.opacity = String(q.opacity * (1 - f.smile));
          }
          const smileEl = smiles[i].current;
          if (smileEl) {
            smileEl.setAttribute("transform", q.smile);
            smileEl.style.opacity = String(q.opacity * f.smile);
          }
        });
      }

      const step = p.sizePx <= 24 ? 1000 / 30 : FULL_FRAME_MS;
      return target.moving || !settled || e.blinkStart !== null ? now + step : Infinity;
    };

    engine.current.last = 0;
    const added = mascotClock().add(frame, svg.current);
    ticket.current = added;
    return () => {
      added.remove();
      ticket.current = null;
    };
  }, []);

  const pointAt = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = (rect.width * BODY_RADIUS) / VIEW_SPAN;
    engine.current.pointer = [
      (event.clientX - (rect.left + rect.width / 2)) / radius,
      (event.clientY - (rect.top + rect.height / 2)) / radius,
    ];
  };
  const pointer = interactive
    ? {
        onPointerEnter: (event: React.PointerEvent<SVGSVGElement>) => {
          engine.current.hover = true;
          pointAt(event);
          wake();
        },
        onPointerMove: (event: React.PointerEvent<SVGSVGElement>) => {
          pointAt(event);
          wake();
        },
        onPointerLeave: () => {
          engine.current.hover = false;
          wake();
        },
        onPointerDown: () => {
          if (engine.current.props.reduced) return;
          engine.current.pressStart = performance.now();
          wake();
        },
      }
    : {};

  const dimension = typeof size === "number" ? `${size}px` : size;
  const label = title === undefined ? `${silhouette.name} mascot` : title;
  const body = silhouette.body.replace(/\{\{GRADIENT\}\}/g, fill);
  const smile = smilePath();

  return (
    <svg
      ref={svg}
      viewBox={VIEW_BOX}
      width={dimension}
      height={dimension}
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      {...pointer}
    >
      <defs>
        <clipPath id={`${uid}-clip`} transform={silhouette.fit || undefined} dangerouslySetInnerHTML={{ __html: silhouette.clip }} />
      </defs>
      <g ref={bodyGroup}>
        <g transform={silhouette.fit || undefined} dangerouslySetInnerHTML={{ __html: body }} />
        <g clipPath={`url(#${uid}-clip)`}>
          {[0, 1].map((i) => (
            <React.Fragment key={i}>
              <path ref={pills[i]} fill={eyeColor} />
              <path
                ref={smiles[i]}
                d={smile}
                fill="none"
                stroke={eyeColor}
                strokeWidth={SMILE_STROKE}
                strokeLinecap="round"
                style={{ opacity: 0 }}
              />
            </React.Fragment>
          ))}
        </g>
      </g>
    </svg>
  );
});
