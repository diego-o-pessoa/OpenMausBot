import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar } from "@/components/Avatar";
import { SphereMascot, type SphereMascotHandle } from "@/components/SphereMascot";
import { ThinkingDots, PresenceMascot } from "@/components/ThinkingDots";
import { MASCOT_CLIPS, type MascotClipName } from "@/components/mascot-clips";
import { TRACK_STEP_MS } from "@/components/mascot-tracks";
import { DOTS_FACE, FRONT_FACE, IDLE_FACE, STILL_WORKING_FACE, dotBeat, faceFromSample, lookToward, type Face, type MascotActivity } from "@/components/sphere-mascot";
import { GROK_BODY_IDS, MAUS_COLOR_NAMES, MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { MASCOT_BODIES, type MascotBodyId } from "../shared/mascot-bodies";
import "./styles.css";
import "./mascot-preview.css";

const at = (clip: MascotClipName, seconds: number) => faceFromSample(MASCOT_CLIPS[clip][Math.round(seconds * 1000 / TRACK_STEP_MS)]);

const NAMED_FACES: Array<[string, Face]> = [
  ["idle", IDLE_FACE],
  ["front", FRONT_FACE],
  ["hover ↘", lookToward(FRONT_FACE, 3, 1.5)],
  ["still", STILL_WORKING_FACE],
  ["dots", { ...DOTS_FACE, dots: 1, beat: dotBeat(0) }],
  ["down-left", at("downScanA", 1.2)],
  ["down-right", at("downScanA", 0.9)],
  ["oval", at("ovalPonder", 1.6)],
  ["up-left", at("glanceUp", 0.6)],
  ["smile", at("celebrate", 1.0)],
];

const ACTIVITIES: readonly MascotActivity[] = ["thinking", "reading", "command", "writing", "looking"];

function FaceSheet() {
  const params = new URLSearchParams(location.search);
  const size = Number(params.get("size") ?? 200);
  const color = (params.get("color") ?? "blue") as MausColor;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", background: "#f0f0f0", width: 5 * size }}>
      {NAMED_FACES.map(([name, face]) => (
        <div key={name} style={{ width: size, height: size + 18 }}>
          <div style={{ font: "12px monospace", height: 18, paddingLeft: 4, color: "#000" }}>{name}</div>
          <SphereMascot face={face} size={size} fill={MAUS_COLORS[color]} silhouette={MASCOT_BODIES.circle} interactive={false} />
        </div>
      ))}
    </div>
  );
}

/** One mascot acting out `?solo=<activity>`, or `done` (works briefly, then finishes) or `press`. */
function Solo() {
  const params = new URLSearchParams(location.search);
  const kind = params.get("solo") ?? "thinking";
  const ref = useRef<SphereMascotHandle>(null);
  const [activity, setActivity] = useState<MascotActivity>(kind === "press" || kind === "idle" ? "idle" : kind === "done" ? "thinking" : (kind as MascotActivity));
  useEffect(() => {
    if (kind === "press") ref.current?.spin(0);
    if (kind !== "done") return;
    const timer = setTimeout(() => setActivity("idle"), 3500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div style={{ background: "#f0f0f0", width: 200, height: 200, padding: 30 }}>
      <SphereMascot ref={ref} activity={activity} size={140} fill={MAUS_COLORS.blue} silhouette={MASCOT_BODIES.circle} interactive />
    </div>
  );
}

function Mood({ activity, color, body, size }: { activity: MascotActivity; color: MausColor; body: MascotBodyId; size: number }) {
  const ref = useRef<SphereMascotHandle>(null);
  return (
    <button type="button" onClick={() => ref.current?.celebrate()} title="Click to celebrate" style={{ background: "none", border: 0, padding: 0 }}>
      <SphereMascot ref={ref} activity={activity} size={size} fill={MAUS_COLORS[color]} silhouette={MASCOT_BODIES[body]} />
    </button>
  );
}

const ROSTER: Array<{ name: string; color: MausColor; body: MascotBodyId; busy?: boolean; unread?: boolean }> = [
  { name: "Chief", color: "teal", body: "circle" },
  { name: "Sales Outbound", color: "orange", body: "circle", busy: true },
  { name: "Inbox Manager", color: "blue", body: "bean", unread: true },
  { name: "Account Manager", color: "purple", body: "pillow" },
  { name: "Talent Scout", color: "blue", body: "circle" },
  { name: "Expense Manager", color: "coral", body: "circle" },
];

function Stage() {
  const [activity, setActivity] = useState<MascotActivity>("thinking");
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <SphereMascot activity={activity} size={96} fill={MAUS_COLORS.blue} silhouette={MASCOT_BODIES.circle} />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[...ACTIVITIES, "idle" as const].map((name) => (
          <button key={name} type="button" onClick={() => setActivity(name)} style={{ fontWeight: name === activity ? 700 : 400 }}>
            {name === "idle" ? "finish" : name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Gallery() {
  const [working, setWorking] = useState(true);
  return (
    <main style={{ padding: 24, display: "grid", gap: 28, background: "#fdfdfd", color: "#111", font: "14px system-ui" }}>
      <section>
        <h2>Stage (switch what it is doing; finish plays the smile and hops)</h2>
        <Stage />
      </section>
      <section>
        <h2>Roster (hover anywhere on a row)</h2>
        <label><input type="checkbox" checked={working} onChange={(e) => setWorking(e.target.checked)} /> Sales Outbound working</label>
        <div style={{ width: 260, marginTop: 12 }}>
          {ROSTER.map((bot) => (
            <div key={bot.name} data-mascot-hover style={{ display: "flex", alignItems: "center", gap: 10, height: 55, padding: "0 8px", borderRadius: 12, background: bot.busy ? "#f0f0f0" : undefined }}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <BotAvatar bot={{ name: bot.name, color: bot.color, mascotBody: bot.body }} state={bot.busy && working ? "thinking" : "idle"} size={38} />
                {bot.unread && <span style={{ position: "absolute", width: 11, height: 11, left: 18, top: 1, borderRadius: 99, background: "#FD3C2F", boxShadow: "0 0 0 2px #fdfdfd" }} />}
              </span>
              <span>{bot.name}</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Activities (click one to celebrate)</h2>
        {(["idle", ...ACTIVITIES] as const).map((activity) => (
          <div key={activity} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            <code style={{ width: 70 }}>{activity}</code>
            {MAUS_COLOR_NAMES.map((color) => <Mood key={color} activity={activity} color={color} body="circle" size={64} />)}
          </div>
        ))}
      </section>
      <section>
        <h2>Bodies</h2>
        <div style={{ display: "flex", gap: 12 }}>
          {GROK_BODY_IDS.map((body) => (
            <figure key={body} style={{ margin: 0, textAlign: "center" }}>
              <Mood activity="idle" color="purple" body={body} size={72} />
              <Mood activity="thinking" color="purple" body={body} size={72} />
              <figcaption>{body}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2>Thinking</h2>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <ThinkingDots color={MAUS_COLORS.orange} />
          <PresenceMascot bot={{ name: "Sales Outbound", color: "orange" }} state={working ? "working" : "thinking"} />
        </div>
      </section>
    </main>
  );
}

const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.has("faces") ? <FaceSheet /> : params.has("solo") ? <Solo /> : <Gallery />}</StrictMode>,
);
