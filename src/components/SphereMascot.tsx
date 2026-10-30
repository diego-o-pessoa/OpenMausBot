import React, { useEffect, useId, useMemo, useRef } from "react";

import type { CursorAvatarHandle, CursorSilhouette } from "./CursorAvatar";
import { FACE_BOX } from "./cursor-face-data";
import { mascotClock, type MascotTicket } from "./mascot-clock";
import { leaseDirector, type MascotDirector } from "./mascot-director";
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
  turnEye,
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
const WIND_LINES = [
  { offset: -0.45, length: 0.75, phase: 0 },
  { offset: 0, length: 1, phase: 0.35 },
  { offset: 0.45, length: 0.6, phase: 0.7 },
] as const;
const WIND_CYCLE_MS = 260;
/** The quill, nib at the origin and y down, in body radii: a feather vane, its shaft and a nib. */
const QUILL_VANE =
  "M0 -0.5C-0.32 -0.75 -0.45 -1 -0.47 -1.15L-0.28 -1.2L-0.45 -1.38C-0.42 -1.75 -0.2 -2.05 0.04 -2.2" +
  "C0.3 -1.95 0.45 -1.65 0.46 -1.45L0.27 -1.5L0.46 -1.3C0.43 -0.95 0.25 -0.7 0 -0.5Z";
const QUILL_SHAFT = "M0 -0.52L0 -0.2";
const QUILL_SPINE = "M0 -0.62C0.01 -1.1 0.02 -1.6 0.03 -2.02";
const QUILL_NIB = "M-0.13 -0.24L0.13 -0.24L0 0.06Z";
const QUILL_EYES = [[-0.19, -1.62], [0.2, -1.55]] as const;
const QUILL_LEAN = 28;
const QUILL_SIZE = 0.78;
const INK_LEFT = -0.9;
const INK_WIDTH = 1.8;
const INK_BASE = 0.8;
const INK_WAVE = 0.125;
const INK_STEP = 0.3;
const INK_STEPS = 60;

/** The written line up to `x`: a wave, one hump every INK_STEP. */
function inkPath(x: number): string {
  const points: string[] = [];
  for (let i = 0; i <= INK_STEPS; i++) {
    const at = INK_LEFT + ((x - INK_LEFT) * i) / INK_STEPS;
    points.push(`${at.toFixed(3)} ${(INK_BASE - INK_WAVE * Math.sin((Math.PI * (at - INK_LEFT)) / INK_STEP)).toFixed(3)}`);
  }
  return `M${points.join("L")}`;
}
const BLINK_GAP_MS: readonly [number, number] = [2500, 6500];
const STIR_GAP_MS: readonly [number, number] = [9000, 20000];
const between = ([low, high]: readonly [number, number]) => low + Math.random() * (high - low);

export interface SphereMascotProps {
  activity?: MascotActivity;
  /** Mascots with the same key (the agent's id) share one performance and move in step. */
  syncKey?: string;
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
  { activity = "idle", syncKey, face, size = 160, fill, silhouette, paused = false, interactive = true, eyeColor = "#ffffff", title, className, style },
  ref,
) {
  const reactId = useId();
  const uid = useMemo(() => "sphere" + reactId.replace(/[^a-zA-Z0-9]/g, ""), [reactId]);
  const svg = useRef<SVGSVGElement | null>(null);
  const bodyGroup = useRef<SVGGElement | null>(null);
  const pills = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const smiles = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const sideDots = [useRef<SVGCircleElement | null>(null), useRef<SVGCircleElement | null>(null)];
  const windGroup = useRef<SVGGElement | null>(null);
  const windLines = [useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null), useRef<SVGPathElement | null>(null)];
  const quillGroup = useRef<SVGGElement | null>(null);
  const inkLine = useRef<SVGPathElement | null>(null);
  const ticket = useRef<MascotTicket | null>(null);
  const sizePx = typeof size === "number" ? size : 160;
  const centre: [number, number] = [silhouette.anchor.x + CIRCLE_ANCHOR_OFFSET[0], silhouette.anchor.y + CIRCLE_ANCHOR_OFFSET[1]];

  const engine = useRef({
    props: { activity, pinned: face, paused, interactive, sizePx, centre },
    face: face ?? (activity === "idle" ? IDLE_FACE : STILL_WORKING_FACE),
    director: null as MascotDirector | null,
    lastActivity: activity,
    pressStart: null as number | null,
    blinkStart: null as number | null,
    hover: false,
    pointer: [0, 0] as [number, number],
    last: 0,
    drawn: "",
    nextBlink: 0,
    nextStir: 0,
  });
  engine.current.props = { activity, pinned: face, paused, interactive, sizePx, centre };
  const wake = () => ticket.current?.wake();

  React.useImperativeHandle(
    ref,
    () => ({
      blink: () => {
        engine.current.blinkStart = performance.now();
        wake();
      },
      spin: () => {
        engine.current.pressStart = performance.now();
        wake();
      },
      setExpression: () => {},
      celebrate: () => {
        const e = engine.current;
        e.director?.celebrate(performance.now(), e.face);
        wake();
      },
    }),
    [],
  );

  useEffect(() => {
    const lease = leaseDirector(syncKey);
    engine.current.director = lease.director;
    return () => {
      lease.release();
      engine.current.director = null;
    };
  }, [syncKey]);

  useEffect(() => {
    const e = engine.current;
    const was = e.lastActivity;
    e.lastActivity = activity;
    const showsLiveState = !paused;
    if (e.director) {
      if (showsLiveState) e.director.setActivity(activity, performance.now(), e.face);
      else if (was !== "idle" && activity === "idle") {
        e.director.setActivity("idle", performance.now(), e.face);
        e.director.celebrate(performance.now(), e.face);
      }
    }
    e.drawn = "";
    wake();
  }, [activity, syncKey, face, paused, interactive, sizePx, silhouette]);

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
      if (working && p.paused) return { face: STILL_WORKING_FACE, moving: false };
      const performed = e.director?.frame(now);
      if (performed) return { face: performed, moving: true };
      if (e.hover && p.interactive) return { face: lookToward(FRONT_FACE, e.pointer[0], e.pointer[1]), moving: false };
      return { face: IDLE_FACE, moving: false };
    };

    const frame = (now: number): number => {
      const e = engine.current;
      const p = e.props;
      const dt = Math.min(Math.max(now - (e.last || now), 0), 50) / 1000;
      e.last = now;
      const alive = !p.pinned && !p.paused;
      if (alive) {
        if (!e.nextBlink) e.nextBlink = now + between(BLINK_GAP_MS);
        if (!e.nextStir) e.nextStir = now + between(STIR_GAP_MS);
        if (now >= e.nextBlink) {
          if (e.blinkStart === null && e.face.quill < 0.01 && e.face.dots < 0.01) e.blinkStart = now;
          e.nextBlink = now + between(BLINK_GAP_MS);
        }
        if (now >= e.nextStir) {
          if (p.activity === "idle" && !e.hover) e.director?.stir(now, e.face);
          e.nextStir = now + between(STIR_GAP_MS);
        }
      }
      const target = targetFace(now);
      e.face = p.pinned ? target.face : mixFace(e.face, target.face, 1 - Math.exp(-dt / EASE_SECONDS));
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
      const quilled = Math.max(0, Math.min(1, f.quill));
      const sx = f.scale * f.stretchX * shrink * (1 - 0.72 * quilled);
      const sy = f.scale * f.stretchY * shrink * (1 + 0.12 * quilled);
      const ox = f.x * BODY_RADIUS;
      const oy = -(f.y + middle.lift * f.dots) * BODY_RADIUS;
      const bodyTransform =
        Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(ox) < 0.01 && Math.abs(oy) < 0.01
          ? ""
          : `translate(${(cx + ox).toFixed(2)} ${(cy + oy).toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
      const bodyOpacity = (1 + (middle.opacity - 1) * f.dots) * Math.max(0, 1 - 1.6 * quilled);
      const eyesShown = Math.max(0, 1 - f.dots * 2.5) * Math.max(0, 1 - 2 * quilled);
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
        const turned = turnEye(eye, f.roll, f.yaw);
        const at = `translate(${(cx + turned.x * BODY_RADIUS).toFixed(2)} ${(cy - turned.y * BODY_RADIUS).toFixed(2)})`;
        const squash = `scale(${turned.squashX.toFixed(3)} ${(turned.squashY * open).toFixed(3)})`;
        return {
          pill: `${at} ${squash} rotate(${eye.angle.toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          smile: `${at} ${squash} rotate(${((((eye.angle + 90) % 180) + 180) % 180 - 90).toFixed(1)}) scale(${BODY_RADIUS.toFixed(3)})`,
          d: pillPath(eye.length, eye.width),
          opacity: eyeOpacity(eye) * eyesShown * turned.shown,
        };
      });
      const gust = Math.min(1, Math.abs(f.wind));
      const rising = f.wind > 0;
      const drift = gust > 0.01 ? (now % WIND_CYCLE_MS) / WIND_CYCLE_MS : 0;
      const winds = WIND_LINES.map((line) => {
        const along = 1.15 + 0.35 * ((drift + line.phase) % 1);
        const length = (0.35 + 0.45 * gust) * line.length;
        const [ax, ay, bx, by] = rising
          ? [line.offset, along, line.offset, along + length]
          : [-along, line.offset, -along - length, line.offset];
        return `M${(cx + ax * BODY_RADIUS).toFixed(2)} ${(cy + ay * BODY_RADIUS).toFixed(2)}L${(cx + bx * BODY_RADIUS).toFixed(2)} ${(cy + by * BODY_RADIUS).toFixed(2)}`;
      });
      const inkX = INK_LEFT + INK_WIDTH * f.ink;
      const inkY = INK_BASE - INK_WAVE * Math.sin((Math.PI * (inkX - INK_LEFT)) / INK_STEP);
      const quillShown = Math.max(0, Math.min(1, (quilled - 0.2) / 0.5));
      const quillTransform = `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${BODY_RADIUS.toFixed(3)}) translate(${inkX.toFixed(3)} ${inkY.toFixed(3)}) rotate(${QUILL_LEAN}) scale(${(QUILL_SIZE * (0.7 + 0.3 * quillShown)).toFixed(3)})`;
      const drawn = `${bodyTransform}|${bodyOpacity.toFixed(3)}|${gust.toFixed(3)}|${winds.join("")}|${quillShown.toFixed(3)}|${quillTransform}|${f.ink.toFixed(3)}|${sides.map((s) => `${s.cy.toFixed(2)},${s.r.toFixed(2)},${s.opacity.toFixed(2)}`).join("|")}|${placed.map((q) => q.pill + q.d + q.opacity.toFixed(2)).join("|")}|${f.smile.toFixed(3)}`;
      if (drawn !== e.drawn) {
        e.drawn = drawn;
        if (bodyGroup.current) {
          if (bodyTransform) bodyGroup.current.setAttribute("transform", bodyTransform);
          else bodyGroup.current.removeAttribute("transform");
          bodyGroup.current.style.opacity = bodyOpacity < 1 ? bodyOpacity.toFixed(3) : "";
        }
        if (windGroup.current) windGroup.current.style.opacity = gust > 0.01 ? (0.55 * gust).toFixed(3) : "0";
        winds.forEach((d, i) => windLines[i].current?.setAttribute("d", d));
        if (quillGroup.current) {
          quillGroup.current.setAttribute("transform", quillTransform);
          quillGroup.current.style.opacity = quillShown > 0 ? quillShown.toFixed(3) : "0";
        }
        if (inkLine.current) {
          inkLine.current.setAttribute("d", f.ink > 0.005 ? inkPath(inkX) : "");
          inkLine.current.style.opacity = quillShown > 0 ? quillShown.toFixed(3) : "0";
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
      if (target.moving || !settled || e.blinkStart !== null) return now + step;
      return alive ? Math.min(e.nextBlink, e.nextStir) : Infinity;
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
      <g ref={windGroup} style={{ opacity: 0 }} stroke={fill} strokeWidth={0.13 * BODY_RADIUS} strokeLinecap="round" fill="none">
        {windLines.map((line, i) => <path key={i} ref={line} />)}
      </g>
      <path
        ref={inkLine}
        transform={`translate(${centre[0]} ${centre[1]}) scale(${BODY_RADIUS})`}
        fill="none"
        stroke={fill}
        strokeWidth={0.09}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0 }}
      />
      <g ref={quillGroup} style={{ opacity: 0 }}>
        <path d={QUILL_VANE} fill={fill} />
        <path d={QUILL_SHAFT} stroke={fill} strokeWidth={0.13} strokeLinecap="round" />
        <path d={QUILL_SPINE} stroke={eyeColor} strokeOpacity={0.35} strokeWidth={0.05} strokeLinecap="round" fill="none" />
        <path d={QUILL_NIB} fill={fill} />
        {QUILL_EYES.map(([x, y], i) => (
          <path key={i} d={pillPath(0.36, 0.17)} fill={eyeColor} transform={`translate(${x} ${y}) rotate(${90 - QUILL_LEAN})`} />
        ))}
      </g>
    </svg>
  );
});
