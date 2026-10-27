import React, { useEffect, useId, useMemo, useRef } from "react";

import type { CursorAvatarHandle, CursorSilhouette } from "./CursorAvatar";
import { FACE_BOX } from "./cursor-face-data";
import { mascotClock, usePrefersReducedMotion, type MascotTicket } from "./mascot-clock";
import { MascotDirector } from "./mascot-director";
import { FULL_FRAME_MS, VIEW_SPAN } from "./mascot-motion";
import { PRESS_TRACK } from "./mascot-tracks";
import {
  BLINK_MS,
  DOT_SPACING,
  FRONT_FACE,
  IDLE_FACE,
  SMILE_STROKE,
  STILL_WORKING_FACE,
  blinkOpenness,
  dotPose,
  eyeOpacity,
  faceDistance,
  lookToward,
  mixFace,
  pillPath,
  smilePath,
  trackDurationMs,
  trackFaceAt,
  type Face,
  type MascotActivity,
} from "./sphere-mascot";

const VIEW_BOX = `-15 -15 ${VIEW_SPAN} ${VIEW_SPAN}`;
const BODY_RADIUS = FACE_BOX / 2;
const CIRCLE_ANCHOR_OFFSET: [number, number] = [0.45, 4];
const EASE_SECONDS = 0.06;
const PRESS_MS = trackDurationMs(PRESS_TRACK);
/** Grok watches the pointer anywhere on the agent's row; the row marks itself with this attribute. */
const HOVER_REGION = "[data-mascot-hover]";

export interface SphereMascotProps {
  activity?: MascotActivity;
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
  { activity = "idle", face, size = 160, fill, silhouette, paused = false, interactive = true, eyeColor = "#ffffff", title, className, style },
  ref,
) {
  const reactId = useId();
  const uid = useMemo(() => "sphere" + reactId.replace(/[^a-zA-Z0-9]/g, ""), [reactId]);
  const svg = useRef<SVGSVGElement | null>(null);
  const bodyGroup = useRef<SVGGElement | null>(null);
  const pills = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const smiles = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const sideDots = [useRef<SVGCircleElement | null>(null), useRef<SVGCircleElement | null>(null)];
  const ticket = useRef<MascotTicket | null>(null);
  const reduced = usePrefersReducedMotion();
  const sizePx = typeof size === "number" ? size : 160;
  const centre: [number, number] = [silhouette.anchor.x + CIRCLE_ANCHOR_OFFSET[0], silhouette.anchor.y + CIRCLE_ANCHOR_OFFSET[1]];

  const engine = useRef({
    props: { activity, pinned: face, paused, reduced, interactive, sizePx, centre },
    face: face ?? (activity === "idle" ? IDLE_FACE : STILL_WORKING_FACE),
    director: new MascotDirector(),
    pressStart: null as number | null,
    blinkStart: null as number | null,
    hover: false,
    pointer: [0, 0] as [number, number],
    last: 0,
    drawn: "",
  });
  engine.current.props = { activity, pinned: face, paused, reduced, interactive, sizePx, centre };
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
        const e = engine.current;
        if (e.props.reduced) return;
        e.director.celebrate(performance.now(), e.face);
        wake();
      },
    }),
    [],
  );

  useEffect(() => {
    const e = engine.current;
    if (reduced) e.director = new MascotDirector();
    else e.director.setActivity(activity, performance.now(), e.face);
    e.drawn = "";
    wake();
  }, [activity, face, paused, reduced, interactive, sizePx, silhouette]);

  useEffect(() => {
    const targetFace = (now: number): { face: Face; moving: boolean } => {
      const e = engine.current;
      const p = e.props;
      if (p.pinned) return { face: p.pinned, moving: false };
      if (e.pressStart !== null) {
        if (now - e.pressStart < PRESS_MS) return { face: trackFaceAt(PRESS_TRACK, now - e.pressStart), moving: true };
        e.pressStart = null;
      }
      const working = p.activity !== "idle";
      if (working && (p.paused || p.reduced)) return { face: STILL_WORKING_FACE, moving: false };
      if (!p.reduced) {
        const performed = e.director.frame(now);
        if (performed) return { face: performed, moving: true };
      }
      if (e.hover && p.interactive) return { face: lookToward(FRONT_FACE, e.pointer[0], e.pointer[1]), moving: false };
      return { face: IDLE_FACE, moving: false };
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
      const middle = dotPose(f.beat[1]);
      const shrink = 1 + (middle.radius - 1) * f.dots;
      const sx = f.scale * f.stretchX * shrink;
      const sy = f.scale * f.stretchY * shrink;
      const ox = f.x * BODY_RADIUS;
      const oy = -(f.y + middle.lift * f.dots) * BODY_RADIUS;
      const bodyTransform =
        Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(ox) < 0.01 && Math.abs(oy) < 0.01
          ? ""
          : `translate(${(cx + ox).toFixed(2)} ${(cy + oy).toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
      const bodyOpacity = 1 + (middle.opacity - 1) * f.dots;
      const eyesShown = Math.max(0, 1 - f.dots * 2.5);
      const sidesShown = Math.max(0, Math.min(1, (f.dots - 0.55) / 0.3));
      const sides = [f.beat[0], f.beat[2]].map((lit, i) => {
        const pose = dotPose(lit);
        return {
          cx: cx + (i === 0 ? -DOT_SPACING : DOT_SPACING) * BODY_RADIUS,
          cy: cy - pose.lift * BODY_RADIUS,
          r: pose.radius * BODY_RADIUS * sidesShown,
          opacity: pose.opacity,
        };
      });
      const placed = f.eyes.map((eye) => {
        const at = `translate(${(cx + eye.x * BODY_RADIUS).toFixed(2)} ${(cy - eye.y * BODY_RADIUS).toFixed(2)})`;
        return {
          pill: `${at} scale(1 ${open.toFixed(3)}) rotate(${eye.angle.toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          smile: `${at} rotate(${((((eye.angle + 90) % 180) + 180) % 180 - 90).toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          d: pillPath(eye.length, eye.width),
          opacity: eyeOpacity(eye) * eyesShown,
        };
      });
      const drawn = `${bodyTransform}|${bodyOpacity.toFixed(3)}|${sides.map((s) => `${s.cy.toFixed(2)},${s.r.toFixed(2)},${s.opacity.toFixed(2)}`).join("|")}|${placed.map((q) => q.pill + q.d + q.opacity.toFixed(2)).join("|")}|${f.smile.toFixed(3)}`;
      if (drawn !== e.drawn) {
        e.drawn = drawn;
        if (bodyGroup.current) {
          if (bodyTransform) bodyGroup.current.setAttribute("transform", bodyTransform);
          else bodyGroup.current.removeAttribute("transform");
          bodyGroup.current.style.opacity = bodyOpacity < 1 ? bodyOpacity.toFixed(3) : "";
        }
        sides.forEach((s, i) => {
          const dot = sideDots[i].current;
          if (!dot) return;
          dot.setAttribute("cx", s.cx.toFixed(2));
          dot.setAttribute("cy", s.cy.toFixed(2));
          dot.setAttribute("r", s.r.toFixed(2));
          dot.style.opacity = s.r > 0 ? s.opacity.toFixed(3) : "0";
        });
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

  useEffect(() => {
    const own = svg.current;
    if (!interactive || !own) return;
    const region: Element = own.closest(HOVER_REGION) ?? own;
    const pointAt = (event: PointerEvent) => {
      const rect = own.getBoundingClientRect();
      const radius = (rect.width * BODY_RADIUS) / VIEW_SPAN;
      if (radius <= 0) return;
      engine.current.pointer = [
        (event.clientX - (rect.left + rect.width / 2)) / radius,
        (event.clientY - (rect.top + rect.height / 2)) / radius,
      ];
    };
    const enter = (event: Event) => {
      engine.current.hover = true;
      pointAt(event as PointerEvent);
      wake();
    };
    const move = (event: Event) => {
      pointAt(event as PointerEvent);
      wake();
    };
    const leave = () => {
      engine.current.hover = false;
      wake();
    };
    region.addEventListener("pointerenter", enter);
    region.addEventListener("pointermove", move);
    region.addEventListener("pointerleave", leave);
    return () => {
      region.removeEventListener("pointerenter", enter);
      region.removeEventListener("pointermove", move);
      region.removeEventListener("pointerleave", leave);
      engine.current.hover = false;
    };
  }, [interactive]);

  const onPointerDown = interactive
    ? () => {
        if (engine.current.props.reduced) return;
        engine.current.pressStart = performance.now();
        wake();
      }
    : undefined;

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
      style={{ overflow: "visible", ...style }}
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      onPointerDown={onPointerDown}
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
      {[0, 1].map((i) => (
        <circle key={i} ref={sideDots[i]} r={0} fill={fill} style={{ opacity: 0 }} />
      ))}
    </svg>
  );
});
