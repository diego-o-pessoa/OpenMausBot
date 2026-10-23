import React, { useEffect, useId, useMemo, useRef } from "react";

import type { CursorAvatarHandle, CursorSilhouette } from "./CursorAvatar";
import { FACE_BOX } from "./cursor-face-data";
import { mascotClock, usePrefersReducedMotion, type MascotTicket } from "./mascot-clock";
import { FULL_FRAME_MS, VIEW_SPAN } from "./mascot-motion";
import {
  BLINK_MS,
  DONE_MS,
  FRONT_POSE,
  HOVER_POSE,
  IDLE_POSE,
  SMILE_STROKE,
  blinkOpenness,
  doneBodyAt,
  donePoseAt,
  eyeLengthScale,
  eyeOpacity,
  mixPose,
  pickGlance,
  pillPath,
  placeEyes,
  poseDistance,
  smilePath,
  workingBreathAt,
  type EyePose,
  type Glance,
  type MascotMood,
} from "./sphere-mascot";

const VIEW_BOX = `-15 -15 ${VIEW_SPAN} ${VIEW_SPAN}`;
const SPHERE_RADIUS = (FACE_BOX / 2) * 0.97;
const CIRCLE_ANCHOR_OFFSET: [number, number] = [0.45, 4];
const GAZE_SECONDS = 0.085;
const PRESS_SCALE = 0.86;
const SPRING_STIFFNESS = 260;
const SPRING_DAMPING = 16;
const BREATH_FRAME_MS = 50;

export interface SphereMascotProps {
  mood?: MascotMood;
  /** Holds the eyes in one pose, for previews and tests. */
  pose?: EyePose;
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

const randomBetween = ([lo, hi]: [number, number]) => lo + Math.random() * (hi - lo);

export const SphereMascot = React.forwardRef<SphereMascotHandle, SphereMascotProps>(function SphereMascot(
  { mood = "idle", pose, size = 160, fill, silhouette, paused = false, interactive = true, eyeColor = "#ffffff", title, className, style },
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
    props: { mood, pinned: pose, paused, reduced, interactive, sizePx, centre },
    pose: { ...(pose ?? (mood === "working" ? FRONT_POSE : IDLE_POSE)) } as EyePose,
    glance: null as Glance | null,
    glanceUntil: 0,
    blinkStart: null as number | null,
    nextBlinkAt: 0,
    doneStart: null as number | null,
    spinStart: null as number | null,
    spinMs: 900,
    hover: false,
    pressed: false,
    scale: 1,
    velocity: 0,
    lastMood: mood,
    last: 0,
    drawn: "",
  });
  engine.current.props = { mood, pinned: pose, paused, reduced, interactive, sizePx, centre };
  const wake = () => ticket.current?.wake();

  React.useImperativeHandle(
    ref,
    () => ({
      blink: () => {
        if (engine.current.props.reduced) return;
        engine.current.blinkStart = performance.now();
        wake();
      },
      spin: (durationMs = 900) => {
        if (engine.current.props.reduced) return;
        engine.current.spinMs = durationMs;
        engine.current.spinStart = performance.now();
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
    if (e.lastMood === "working" && mood !== "working" && !reduced) e.doneStart = performance.now();
    if (mood === "working") e.doneStart = null;
    e.lastMood = mood;
    e.drawn = "";
    wake();
  }, [mood, pose, paused, reduced, interactive, sizePx, silhouette]);

  useEffect(() => {
    const targetPose = (now: number): EyePose => {
      const e = engine.current;
      const p = e.props;
      if (p.pinned) return p.pinned;
      if (e.doneStart !== null) {
        const done = donePoseAt(now - e.doneStart);
        if (done) return done;
        e.doneStart = null;
      }
      if (e.hover && p.interactive) return HOVER_POSE;
      if (p.mood !== "working") return IDLE_POSE;
      if (p.paused || p.reduced) return FRONT_POSE;
      if (!e.glance || now >= e.glanceUntil) {
        e.glance = pickGlance(Math.random, e.glance);
        e.glanceUntil = now + randomBetween(e.glance.holdMs);
      }
      return e.glance.pose;
    };

    const frame = (now: number): number => {
      const e = engine.current;
      const p = e.props;
      const dt = Math.min(Math.max(now - (e.last || now), 0), 50) / 1000;
      e.last = now;
      const animatedWork = p.mood === "working" && !p.paused && !p.reduced;

      const target = targetPose(now);
      e.pose = p.reduced ? { ...target } : mixPose(e.pose, target, 1 - Math.exp(-dt / GAZE_SECONDS));
      const settled = poseDistance(e.pose, target) < 0.002;
      if (settled) e.pose = { ...target };

      if (animatedWork && e.blinkStart === null && now >= e.nextBlinkAt) {
        if (e.nextBlinkAt !== 0) e.blinkStart = now;
        e.nextBlinkAt = now + randomBetween([2000, 5200]);
      }
      let open = 1;
      if (e.blinkStart !== null) {
        open = blinkOpenness(now - e.blinkStart);
        if (now - e.blinkStart >= BLINK_MS) e.blinkStart = null;
      }

      let spinYaw = 0;
      if (e.spinStart !== null) {
        const t = (now - e.spinStart) / e.spinMs;
        if (t >= 1) e.spinStart = null;
        else spinYaw = Math.PI * 2 * (0.5 - Math.cos(Math.PI * t) / 2);
      }

      const pressTarget = e.pressed && p.interactive ? PRESS_SCALE : 1;
      if (p.reduced) {
        e.scale = pressTarget;
        e.velocity = 0;
      } else {
        e.velocity += (SPRING_STIFFNESS * (pressTarget - e.scale) - SPRING_DAMPING * e.velocity) * dt;
        e.scale += e.velocity * dt;
        if (Math.abs(pressTarget - e.scale) < 0.0005 && Math.abs(e.velocity) < 0.005) {
          e.scale = pressTarget;
          e.velocity = 0;
        }
      }
      const springing = e.scale !== pressTarget || e.velocity !== 0;
      const doneElapsed = e.doneStart === null ? -1 : now - e.doneStart;
      const hop = doneBodyAt(doneElapsed);
      const breath = animatedWork ? workingBreathAt(now) : 1;
      const [cx, cy] = p.centre;
      const base = cy;
      const sx = e.scale * breath * hop.scaleX;
      const sy = e.scale * breath * hop.scaleY;
      const bodyTransform =
        sx === 1 && sy === 1 && hop.lift === 0
          ? ""
          : `translate(${cx.toFixed(2)} ${(base - hop.lift * SPHERE_RADIUS).toFixed(2)}) scale(${sx.toFixed(4)} ${sy.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-base).toFixed(2)})`;

      const pose: EyePose = { ...e.pose, yaw: e.pose.yaw + spinYaw, open: e.pose.open * open };
      const placements = placeEyes(pose, cx, cy, SPHERE_RADIUS);
      const pill = pillPath(pose.width, pose.length * eyeLengthScale(pose) * pose.open * (1 - 0.6 * pose.smile));
      const drawn = `${bodyTransform}|${pill}|${placements.map((pl) => pl.matrix.map((n) => n.toFixed(2)).join(",")).join("|")}|${pose.smile.toFixed(3)}`;
      if (drawn !== e.drawn) {
        e.drawn = drawn;
        if (bodyGroup.current) {
          if (bodyTransform) bodyGroup.current.setAttribute("transform", bodyTransform);
          else bodyGroup.current.removeAttribute("transform");
        }
        placements.forEach((placement, i) => {
          const matrix = `matrix(${placement.matrix.map((n) => n.toFixed(3)).join(" ")})`;
          const visible = eyeOpacity(placement.depth);
          const pillEl = pills[i].current;
          if (pillEl) {
            pillEl.setAttribute("d", pill);
            pillEl.setAttribute("transform", matrix);
            pillEl.style.opacity = String(visible * (1 - pose.smile));
          }
          const smileEl = smiles[i].current;
          if (smileEl) {
            smileEl.setAttribute("transform", matrix);
            smileEl.style.opacity = String(visible * pose.smile);
          }
        });
      }

      const moving =
        !settled || springing || e.blinkStart !== null || e.spinStart !== null || (e.doneStart !== null && doneElapsed < DONE_MS);
      const step = p.sizePx <= 24 ? 1000 / 30 : FULL_FRAME_MS;
      if (moving) return now + step;
      if (animatedWork) return Math.min(now + BREATH_FRAME_MS, e.glanceUntil, Math.max(e.nextBlinkAt, now + step));
      return Infinity;
    };

    engine.current.last = 0;
    const added = mascotClock().add(frame, svg.current);
    ticket.current = added;
    return () => {
      added.remove();
      ticket.current = null;
    };
  }, []);

  const pointer = interactive
    ? {
        onPointerEnter: () => {
          engine.current.hover = true;
          wake();
        },
        onPointerLeave: () => {
          engine.current.hover = false;
          engine.current.pressed = false;
          wake();
        },
        onPointerDown: () => {
          engine.current.pressed = true;
          wake();
        },
        onPointerUp: () => {
          engine.current.pressed = false;
          wake();
        },
        onPointerCancel: () => {
          engine.current.pressed = false;
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
