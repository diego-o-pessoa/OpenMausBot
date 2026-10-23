import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar } from "@/components/Avatar";
import { SphereMascot, type SphereMascotHandle } from "@/components/SphereMascot";
import { ThinkingDots, PresenceMascot } from "@/components/ThinkingDots";
import { DONE_TRACK, TRACK_STEP_MS, WORKING_TRACK } from "@/components/mascot-tracks";
import { HOVER_FACE, IDLE_FACE, STILL_WORKING_FACE, faceFromSample, lookToward, type Face, type MascotMood } from "@/components/sphere-mascot";
import { GROK_BODY_IDS, MAUS_COLOR_NAMES, MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { MASCOT_BODIES, type MascotBodyId } from "../shared/mascot-bodies";
import "./styles.css";
import "./mascot-preview.css";

const at = (track: typeof WORKING_TRACK, seconds: number) => faceFromSample(track[Math.round(seconds * 1000 / TRACK_STEP_MS)]);

const NAMED_FACES: Array<[string, Face]> = [
  ["idle", IDLE_FACE],
  ["hover", HOVER_FACE],
  ["hover ↘", lookToward(HOVER_FACE, 0.8, 0.6)],
  ["still", STILL_WORKING_FACE],
  ["front", at(WORKING_TRACK, 1.6)],
  ["down-left", at(WORKING_TRACK, 3.6)],
  ["up-right", at(WORKING_TRACK, 5.2)],
  ["big", at(WORKING_TRACK, 8.8)],
  ["up", at(WORKING_TRACK, 9.6)],
  ["smile", at(DONE_TRACK, 2.0)],
];

function FaceSheet() {
  const params = new URLSearchParams(location.search);
  const size = Number(params.get("size") ?? 200);
  const color = (params.get("color") ?? "orange") as MausColor;
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

function Solo() {
  const params = new URLSearchParams(location.search);
  const kind = params.get("solo") ?? "working";
  const ref = useRef<SphereMascotHandle>(null);
  const [mood, setMood] = useState<MascotMood>(kind === "idle" ? "idle" : "working");
  useEffect(() => {
    if (kind === "press") ref.current?.spin(0);
    if (kind !== "done") return;
    const timer = setTimeout(() => setMood("idle"), 600);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div style={{ background: "#f0f0f0", width: 200, height: 200 }}>
      <SphereMascot ref={ref} mood={kind === "press" ? "idle" : mood} size={200} fill={MAUS_COLORS.orange} silhouette={MASCOT_BODIES.circle} interactive />
    </div>
  );
}

function Mood({ mood, color, body, size }: { mood: MascotMood; color: MausColor; body: MascotBodyId; size: number }) {
  const ref = useRef<SphereMascotHandle>(null);
  return (
    <button type="button" onClick={() => ref.current?.celebrate()} title="Click to celebrate" style={{ background: "none", border: 0, padding: 0 }}>
      <SphereMascot ref={ref} mood={mood} size={size} fill={MAUS_COLORS[color]} silhouette={MASCOT_BODIES[body]} />
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

function Gallery() {
  const [working, setWorking] = useState(true);
  return (
    <main style={{ padding: 24, display: "grid", gap: 28, background: "#fdfdfd", color: "#111", font: "14px system-ui" }}>
      <section>
        <h2>Roster</h2>
        <label><input type="checkbox" checked={working} onChange={(e) => setWorking(e.target.checked)} /> Sales Outbound working</label>
        <div style={{ width: 260, marginTop: 12 }}>
          {ROSTER.map((bot) => (
            <div key={bot.name} style={{ display: "flex", alignItems: "center", gap: 10, height: 55, padding: "0 8px", borderRadius: 12, background: bot.busy ? "#f0f0f0" : undefined }}>
              <span style={{ position: "relative", display: "inline-flex" }}>
                <BotAvatar bot={{ name: bot.name, color: bot.color, mascotBody: bot.body }} state={bot.busy && working ? "working" : "idle"} size={38} />
                {bot.unread && <span style={{ position: "absolute", width: 11, height: 11, left: 18, top: 1, borderRadius: 99, background: "#FD3C2F", boxShadow: "0 0 0 2px #fdfdfd" }} />}
              </span>
              <span>{bot.name}</span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2>Moods (click one to celebrate, hover to be watched)</h2>
        {(["idle", "working"] as const).map((mood) => (
          <div key={mood} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
            <code style={{ width: 70 }}>{mood}</code>
            {MAUS_COLOR_NAMES.map((color) => <Mood key={color} mood={mood} color={color} body="circle" size={64} />)}
          </div>
        ))}
      </section>
      <section>
        <h2>Bodies</h2>
        <div style={{ display: "flex", gap: 12 }}>
          {GROK_BODY_IDS.map((body) => (
            <figure key={body} style={{ margin: 0, textAlign: "center" }}>
              <Mood mood="idle" color="purple" body={body} size={72} />
              <Mood mood="working" color="purple" body={body} size={72} />
              <figcaption>{body}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2>Thinking</h2>
        <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
          <ThinkingDots color={MAUS_COLORS.orange} />
          <PresenceMascot bot={{ name: "Sales Outbound", color: "orange" }} working={working} />
        </div>
      </section>
    </main>
  );
}

const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <StrictMode>{params.has("faces") ? <FaceSheet /> : params.has("solo") ? <Solo /> : <Gallery />}</StrictMode>,
);
