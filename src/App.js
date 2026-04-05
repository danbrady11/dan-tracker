import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

// ─── Constants ───────────────────────────────────────────────────────────────

const START_DATE = new Date("2026-04-05");
const END_DATE   = new Date("2026-05-26");
const TOTAL_DAYS = Math.round((END_DATE - START_DATE) / (1000 * 60 * 60 * 24));
const USER_ID    = "dan";

const WEIGHT_TARGETS = {
  0: 239, 6: 231, 13: 227, 20: 224, 27: 221, 34: 218, 41: 216, 51: 214
};

const BUSINESS_TRIP_DAYS = [29, 30, 31, 32];

const GRINDSTONE_OVERRIDES = {
  26: "Grindstone — Optional Two",
  28: "Grindstone — Lower",
  29: "Grindstone — Upper",
  30: "Grindstone — Conditioning",
  31: "Grindstone — Optional One",
  34: "Grindstone — Optional Two",
};

const NO_HGH_DAYS = [27];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWeightTarget(day) {
  const keys = Object.keys(WEIGHT_TARGETS).map(Number).sort((a, b) => a - b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (day >= keys[i]) {
      const k1 = keys[i], k2 = keys[i + 1];
      if (k2 === undefined) return WEIGHT_TARGETS[k1];
      const t = (day - k1) / (k2 - k1);
      return +(WEIGHT_TARGETS[k1] + t * (WEIGHT_TARGETS[k2] - WEIGHT_TARGETS[k1])).toFixed(1);
    }
  }
  return 239;
}

function getDayIndex(dateStr) {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const s = new Date(START_DATE); s.setHours(0, 0, 0, 0);
  return Math.round((d - s) / (1000 * 60 * 60 * 24));
}

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function getDayOfWeek(dateStr) {
  return new Date(dateStr + "T12:00:00").getDay();
}

function getChecklist(dow, dayIndex) {
  const isWed  = dow === 3;
  const isSun  = dow === 0;
  const isBusinessTrip   = BUSINESS_TRIP_DAYS.includes(dayIndex);
  const isStaycationRest = NO_HGH_DAYS.includes(dayIndex);

  if (isBusinessTrip) {
    const items = [];
    items.push({ id: "hgh",           label: "HGH",                          group: "Morning" });
    items.push({ id: "morning_supps", label: "Morning Supplements",           group: "Morning" });
    items.push({ id: "breakfast",     label: "Breakfast — Whey / Collagen",   group: "Food"    });
    items.push({ id: "protein_bar",   label: "Protein Bar",                   group: "Snacks"  });
    if (GRINDSTONE_OVERRIDES[dayIndex])
      items.push({ id: "grindstone", label: GRINDSTONE_OVERRIDES[dayIndex],   group: "Training" });
    items.push({ id: "evening_supps", label: isWed ? "Other Supplements" : "Evening Supplements", group: "Evening" });
    return items;
  }

  if (isStaycationRest) {
    return [
      { id: "morning_supps", label: "Morning Supplements",                    group: "Morning" },
      { id: "breakfast",     label: "Breakfast — Whey / Collagen / Yogurt",   group: "Food"    },
      { id: "lunch",         label: "Lunch — Turkey Burger + Cottage Cheese", group: "Food"    },
      { id: "cottage_cheese",label: "Cottage Cheese",                         group: "Snacks"  },
      { id: "yogurt",        label: "Yogurt",                                 group: "Snacks"  },
      { id: "protein_bar",   label: "Protein Bar",                            group: "Snacks"  },
      { id: "evening_supps", label: "Evening Supplements",                    group: "Evening" },
    ];
  }

  const isTraining  = [1,2,3,4,6].includes(dow);
  const isTrulyRest = [0,5].includes(dow) && !GRINDSTONE_OVERRIDES[dayIndex];
  const items = [];

  items.push({ id: "hgh",           label: "HGH",                            group: "Morning" });
  if ([1,2,4].includes(dow))
    items.push({ id: "towers",      label: "Towers",                         group: "Morning" });
  if (isTrulyRest)
    items.push({ id: "walk",        label: "Long Walk",                      group: "Morning" });
  items.push({ id: "morning_supps", label: "Morning Supplements",            group: "Morning" });
  items.push({ id: "breakfast",     label: "Breakfast — Whey / Collagen / Yogurt", group: "Food" });
  items.push({ id: "lunch",         label: isTrulyRest ? "Lunch — Turkey Burger + Cottage Cheese" : "Lunch — Turkey Bowl", group: "Food" });

  if (GRINDSTONE_OVERRIDES[dayIndex])
    items.push({ id: "grindstone", label: GRINDSTONE_OVERRIDES[dayIndex],    group: "Training" });
  else if (isTraining) {
    const label =
      dow === 1 ? "Grindstone — Lower"       :
      dow === 2 ? "Grindstone — Upper"       :
      dow === 3 ? "Grindstone — Conditioning":
      dow === 4 ? "Grindstone — Optional One":
                  "Grindstone — Optional Two";
    items.push({ id: "grindstone", label, group: "Training" });
  }

  if (isTrulyRest)
    items.push({ id: "shoulder_rehab", label: "Shoulder Rehab",              group: "Training" });

  items.push({ id: "cottage_cheese", label: "Cottage Cheese",                group: "Snacks"  });
  items.push({ id: "yogurt",         label: "Yogurt",                        group: "Snacks"  });
  items.push({ id: "protein_bar",    label: "Protein Bar",                   group: "Snacks"  });
  items.push({ id: "evening_supps",  label: (isWed || isSun) ? "Other Supplements" : "Evening Supplements", group: "Evening" });

  return items;
}

// ─── Firebase ─────────────────────────────────────────────────────────────────

async function loadAllData() {
  try {
    const snap = await getDoc(doc(db, "users", USER_ID));
    return snap.exists() ? snap.data().entries || {} : {};
  } catch { return {}; }
}

async function saveAllData(data) {
  try {
    await setDoc(doc(db, "users", USER_ID), { entries: data }, { merge: true });
  } catch(e) { console.error("Save failed:", e); }
}

// ─── Component ───────────────────────────────────────────────────────────────

const GROUPS = ["Morning", "Food", "Training", "Snacks", "Evening"];

const HABIT_DEFS = [
  { id: "sober",         label: "Alcohol Free",   check: e => e.sober === true,       always: true  },
  { id: "hgh",           label: "HGH",            check: e => e.checks?.hgh,          always: true  },
  { id: "morning_supps", label: "Morning Supps",  check: e => e.checks?.morning_supps,always: true  },
  { id: "breakfast",     label: "Breakfast",      check: e => e.checks?.breakfast,    always: true  },
  { id: "lunch",         label: "Lunch",          check: e => e.checks?.lunch,        always: true  },
  { id: "cottage_cheese",label: "Cottage Cheese", check: e => e.checks?.cottage_cheese,always: true },
  { id: "yogurt",        label: "Yogurt",         check: e => e.checks?.yogurt,       always: true  },
  { id: "protein_bar",   label: "Protein Bar",    check: e => e.checks?.protein_bar,  always: true  },
  { id: "evening_supps", label: "Evening Supps",  check: e => e.checks?.evening_supps,always: true  },
  { id: "grindstone",    label: "Grindstone",     check: e => e.checks?.grindstone,   trainingOnly: true },
  { id: "towers",        label: "Towers",         check: e => e.checks?.towers,       towersOnly: true   },
  { id: "walk",          label: "Long Walk",      check: e => e.checks?.walk,         restOnly: true     },
  { id: "shoulder_rehab",label: "Shoulder Rehab", check: e => e.checks?.shoulder_rehab,restOnly: true   },
];

export default function App() {
  const [data,      setData]      = useState({});
  const [loaded,    setLoaded]    = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [activeTab, setActiveTab] = useState("today");
  const [todayStr]                = useState(getTodayStr);
  const [form,      setForm]      = useState({ weight: "", hrv: "", rhr: "", sober: null, feel: "" });

  const todayIndex = getDayIndex(todayStr);
  const todayDow   = getDayOfWeek(todayStr);
  const checklist  = getChecklist(todayDow, todayIndex);
  const todayEntry = data[todayStr] || {};
  const todayChecks= todayEntry.checks || {};
  const daysLeft   = TOTAL_DAYS - todayIndex;
  const todayTarget= getWeightTarget(todayIndex);
  const isTraining = [1,2,3,4,6].includes(todayDow);
  const dayLabel   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][todayDow];
  const completedCount = checklist.filter(i => todayChecks[i.id]).length;

  const entries = Object.entries(data)
    .map(([date, v]) => ({ date, ...v, dayIndex: getDayIndex(date) }))
    .filter(e => e.dayIndex >= 0 && e.dayIndex <= TOTAL_DAYS)
    .sort((a, b) => b.dayIndex - a.dayIndex);

  const latestWeight = entries.find(e => e.weight)?.weight;
  const latestHRV    = entries.find(e => e.hrv)?.hrv;
  const latestRHR    = entries.find(e => e.rhr)?.rhr;
  const weightDelta  = latestWeight ? (latestWeight - 239).toFixed(1) : null;
  const weightVsTarget = latestWeight ? (latestWeight - todayTarget).toFixed(1) : null;

  const soberStreak = (() => {
    let s = 0;
    for (let i = todayIndex; i >= 0; i--) {
      const d = new Date(START_DATE); d.setDate(d.getDate() + i);
      if (data[d.toISOString().split("T")[0]]?.sober === true) s++;
      else break;
    }
    return s;
  })();

  useEffect(() => {
    loadAllData().then(d => {
      setData(d);
      if (d[todayStr]) {
        const e = d[todayStr];
        setForm({ weight: e.weight || "", hrv: e.hrv || "", rhr: e.rhr || "", sober: e.sober ?? null, feel: e.feel || "" });
      }
      setLoaded(true);
    });
  }, []);

  async function handleSubmit() {
    setSaving(true);
    const updated = { ...data, [todayStr]: { ...(data[todayStr] || {}), weight: form.weight ? +form.weight : null, hrv: form.hrv ? +form.hrv : null, rhr: form.rhr ? +form.rhr : null, sober: form.sober, feel: form.feel ? +form.feel : null }};
    setData(updated);
    await saveAllData(updated);
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  async function toggleCheck(id) {
    const updated = { ...data, [todayStr]: { ...(data[todayStr] || {}), checks: { ...todayChecks, [id]: !todayChecks[id] }}};
    setData(updated);
    await saveAllData(updated);
  }

  // Chart
  const chartEntries = entries.slice(0, 14).reverse();
  const chartWeights = chartEntries.map(e => e.weight).filter(Boolean);
  const chartMin = chartWeights.length ? Math.min(...chartWeights) - 2 : 210;
  const chartMax = chartWeights.length ? Math.max(...chartWeights) + 2 : 245;
  function toY(val, h) { return h - ((val - chartMin) / (chartMax - chartMin)) * h; }
  const svgW = 320, svgH = 100;
  const chartPoints  = chartEntries.map((e,i) => e.weight ? `${(i/Math.max(chartEntries.length-1,1))*svgW},${toY(e.weight,svgH)}` : null).filter(Boolean);
  const targetPoints = chartEntries.map((e,i) => `${(i/Math.max(chartEntries.length-1,1))*svgW},${toY(getWeightTarget(e.dayIndex),svgH)}`);

  if (!loaded) return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"monospace", color:"#444", letterSpacing:3, fontSize:11, textTransform:"uppercase" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#e8e4dc", fontFamily:"'DM Mono','Courier New',monospace", paddingBottom:80, maxWidth:480, margin:"0 auto" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        input{background:transparent;border:none;outline:none;color:#e8e4dc;font-family:inherit;}
        .field{border-bottom:1px solid #2a2a2a;padding:10px 0;display:flex;justify-content:space-between;align-items:center;}
        .field input{text-align:right;font-size:18px;width:80px;}
        .tab{padding:10px 0;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:2px;text-transform:uppercase;background:transparent;color:#555;flex:1;transition:all 0.2s;}
        .tab.active{color:#c8f060;border-bottom-color:#c8f060;}
        .sober-btn{flex:1;padding:14px;border:1px solid #2a2a2a;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;text-transform:uppercase;transition:all 0.2s;background:transparent;color:#666;}
        .sober-btn.yes.active{border-color:#c8f060;color:#c8f060;background:rgba(200,240,96,0.05);}
        .sober-btn.no.active{border-color:#ff4444;color:#ff4444;background:rgba(255,68,68,0.05);}
        .submit-btn{width:100%;padding:16px;background:#c8f060;color:#0a0a0a;border:none;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:3px;text-transform:uppercase;font-weight:500;}
        .check-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #161616;cursor:pointer;-webkit-tap-highlight-color:transparent;}
        .checkbox{width:24px;height:24px;border:1px solid #2a2a2a;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.15s;border-radius:2px;}
        .checkbox.checked{border-color:#c8f060;background:rgba(200,240,96,0.1);}
        .entry-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #161616;}
        .group-hd{font-size:9px;letter-spacing:3px;color:#333;text-transform:uppercase;padding:16px 0 6px;}
        .pbar{height:2px;background:#1a1a1a;margin-top:8px;}
        .pfill{height:2px;background:#c8f060;transition:width 0.4s;}
        .ahead{color:#c8f060;}.behind{color:#ff6b6b;}
      `}</style>

      {/* Header */}
      <div style={{ background:"#0f0f0f", borderBottom:"1px solid #1a1a1a", padding:"48px 20px 16px" }}>
        <div style={{ fontSize:11, letterSpacing:4, color:"#555", textTransform:"uppercase", marginBottom:4 }}>Operation Vacation</div>
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:52, lineHeight:1, color:"#e8e4dc", letterSpacing:2 }}>
          DAY {Math.max(0, todayIndex+1)}<span style={{ fontSize:20, color:"#444", marginLeft:12 }}>/ {TOTAL_DAYS}</span>
        </div>
        <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
          {[
            { label:"LEFT",   val:`${daysLeft}d`,    color:"#c8f060" },
            { label:"STREAK", val:`${soberStreak}d`, color:soberStreak>0?"#c8f060":"#ff4444" },
            { label:"TARGET", val:`${todayTarget} lb`,color:"#888" },
            { label:"",       val:`${dayLabel} — ${isTraining?"Training":"Rest"}`, color:isTraining?"#c8f060":"#888" },
          ].map((p,i) => (
            <div key={i} style={{ background:"#161616", padding:"6px 12px", fontSize:11, letterSpacing:1 }}>
              {p.label && <span style={{ color:"#555" }}>{p.label} </span>}
              <span style={{ color:p.color }}>{p.val}</span>
            </div>
          ))}
          {weightVsTarget !== null && (
            <div style={{ background:"#161616", padding:"6px 12px", fontSize:11, letterSpacing:1 }}>
              <span className={+weightVsTarget<=0?"ahead":"behind"}>
                {+weightVsTarget<=0?"▲":"▼"} {Math.abs(weightVsTarget)} lb {+weightVsTarget<=0?"AHEAD":"BEHIND"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", background:"#0f0f0f", borderBottom:"1px solid #1a1a1a" }}>
        {["today","checklist","habits","chart","log"].map(t => (
          <button key={t} className={`tab ${activeTab===t?"active":""}`} onClick={() => setActiveTab(t)}>{t}</button>
        ))}
      </div>

      {/* ── TODAY ── */}
      {activeTab === "today" && (
        <div style={{ padding:"20px" }}>
          <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:16 }}>
            {new Date(todayStr+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
            {[{label:"Weight",value:latestWeight||"—",unit:"lb",delta:weightDelta},{label:"HRV",value:latestHRV||"—",unit:"ms"},{label:"RHR",value:latestRHR||"—",unit:"bpm"}].map(s => (
              <div key={s.label} style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", padding:"12px 10px" }}>
                <div style={{ fontSize:9, letterSpacing:2, color:"#444", textTransform:"uppercase", marginBottom:6 }}>{s.label}</div>
                <div style={{ fontFamily:"'Bebas Neue'", fontSize:28, lineHeight:1, color:"#e8e4dc" }}>{s.value}</div>
                <div style={{ fontSize:9, color:"#444", marginTop:2 }}>{s.unit}
                  {s.delta && <span style={{ color:+s.delta<=0?"#c8f060":"#ff6b6b", marginLeft:4 }}>{+s.delta>0?"+":""}{s.delta}</span>}
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", padding:"12px 14px", marginBottom:20 }}>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ fontSize:10, letterSpacing:2, color:"#555", textTransform:"uppercase" }}>Checklist</span>
              <span style={{ fontSize:11, color:completedCount===checklist.length?"#c8f060":"#666" }}>{completedCount}/{checklist.length}</span>
            </div>
            <div className="pbar"><div className="pfill" style={{ width:`${checklist.length?(completedCount/checklist.length)*100:0}%` }} /></div>
          </div>

          <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:12 }}>Log Today</div>
          {[{key:"weight",label:"WEIGHT",unit:"lb",step:"0.1"},{key:"hrv",label:"HRV",unit:"ms"},{key:"rhr",label:"RHR",unit:"bpm"},{key:"feel",label:"FEEL (1–10)",unit:"",min:1,max:10}].map(f => (
            <div key={f.key} className="field">
              <span style={{ fontSize:12, letterSpacing:1, color:"#888" }}>{f.label}</span>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <input type="number" placeholder="—" value={form[f.key]} onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))} step={f.step} min={f.min} max={f.max} />
                {f.unit && <span style={{ fontSize:11, color:"#444" }}>{f.unit}</span>}
              </div>
            </div>
          ))}

          <div style={{ marginTop:20, marginBottom:20 }}>
            <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:10 }}>Alcohol Free Today?</div>
            <div style={{ display:"flex", gap:8 }}>
              <button className={`sober-btn yes ${form.sober===true?"active":""}`} onClick={() => setForm(f=>({...f,sober:true}))}>✓ Yes</button>
              <button className={`sober-btn no ${form.sober===false?"active":""}`} onClick={() => setForm(f=>({...f,sober:false}))}>✗ No</button>
            </div>
          </div>

          <button className="submit-btn" onClick={handleSubmit}>
            {saving ? "Saving..." : saved ? "✓ Saved" : "Log Entry"}
          </button>

          <div style={{ marginTop:24, padding:"12px", borderLeft:"2px solid #c8f060", fontSize:11, color:"#555", letterSpacing:1, lineHeight:1.6 }}>
            {soberStreak===0 && "Day 1 starts now. Everything else is dialed. This is the only variable."}
            {soberStreak===1 && "One day down. The first weekend is the hardest. Plan it."}
            {soberStreak>=2 && soberStreak<7 && `${soberStreak} days. Habit loop still fighting back. Hold the line.`}
            {soberStreak>=7 && soberStreak<14 && `${soberStreak} days. Peak craving window. HRV should be climbing.`}
            {soberStreak>=14 && soberStreak<21 && `${soberStreak} days. Neurological rewire underway. Getting easier now.`}
            {soberStreak>=21 && `${soberStreak} days. New normal. Stack is firing clean.`}
          </div>
        </div>
      )}

      {/* ── CHECKLIST ── */}
      {activeTab === "checklist" && (
        <div style={{ padding:"20px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
            <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase" }}>
              {new Date(todayStr+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}
            </div>
            <div style={{ fontSize:12, color:completedCount===checklist.length?"#c8f060":"#666" }}>{completedCount}/{checklist.length}</div>
          </div>
          <div className="pbar" style={{ marginBottom:4 }}><div className="pfill" style={{ width:`${checklist.length?(completedCount/checklist.length)*100:0}%` }} /></div>
          {GROUPS.map(group => {
            const items = checklist.filter(i => i.group===group);
            if (!items.length) return null;
            return (
              <div key={group}>
                <div className="group-hd">{group}</div>
                {items.map(item => (
                  <div key={item.id} className="check-row" onClick={() => toggleCheck(item.id)}>
                    <div className={`checkbox ${todayChecks[item.id]?"checked":""}`}>
                      {todayChecks[item.id] && <span style={{ color:"#c8f060", fontSize:14 }}>✓</span>}
                    </div>
                    <span style={{ fontSize:13, color:todayChecks[item.id]?"#444":"#e8e4dc", textDecoration:todayChecks[item.id]?"line-through":"none" }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* ── HABITS ── */}
      {activeTab === "habits" && (() => {
        const loggedEntries = entries.filter(e => e.dayIndex >= 0 && e.dayIndex < todayIndex);
        const stats = HABIT_DEFS.map(h => {
          const applicable = loggedEntries.filter(e => {
            const dow = getDayOfWeek(e.date);
            const di  = getDayIndex(e.date);
            const isTrain  = [1,2,3,4,6].includes(dow) || !!GRINDSTONE_OVERRIDES[di];
            const isRest   = [0,5].includes(dow) && !BUSINESS_TRIP_DAYS.includes(di) && !NO_HGH_DAYS.includes(di) && !GRINDSTONE_OVERRIDES[di];
            const isTowers = [1,2,4].includes(dow) && !BUSINESS_TRIP_DAYS.includes(di);
            if (h.trainingOnly) return isTrain;
            if (h.restOnly)     return isRest;
            if (h.towersOnly)   return isTowers;
            return true;
          });
          const done = applicable.filter(e => h.check(e)).length;
          const pct  = applicable.length ? Math.round((done/applicable.length)*100) : null;
          return { ...h, done, total: applicable.length, pct };
        }).filter(s => s.total > 0);

        const overall = stats.length ? Math.round(stats.reduce((a,s)=>a+s.pct,0)/stats.length) : null;

        return (
          <div style={{ padding:"20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase" }}>Habit Compliance</div>
              {overall !== null && <div style={{ fontSize:11, color:overall>=80?"#c8f060":overall>=60?"#f0c060":"#ff6b6b" }}>{overall}% overall</div>}
            </div>
            <div style={{ fontSize:10, color:"#333", letterSpacing:1, marginBottom:16 }}>{loggedEntries.length} of {TOTAL_DAYS} days logged</div>
            {loggedEntries.length === 0
              ? <div style={{ color:"#444", fontSize:12, padding:"40px 0", textAlign:"center" }}>Start logging to see habit stats</div>
              : stats.map(s => {
                  const color = s.pct>=80?"#c8f060":s.pct>=60?"#f0c060":"#ff6b6b";
                  return (
                    <div key={s.id} style={{ borderBottom:"1px solid #161616", padding:"12px 0" }}>
                      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                        <span style={{ fontSize:12, color:"#e8e4dc" }}>{s.label}</span>
                        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                          <span style={{ fontSize:11, color:"#444" }}>{s.done}/{s.total}</span>
                          <span style={{ fontSize:14, color, fontFamily:"'Bebas Neue'", minWidth:40, textAlign:"right" }}>{s.pct}%</span>
                        </div>
                      </div>
                      <div style={{ height:2, background:"#1a1a1a" }}>
                        <div style={{ height:2, background:color, width:`${s.pct}%`, transition:"width 0.4s" }} />
                      </div>
                    </div>
                  );
                })
            }
          </div>
        );
      })()}

      {/* ── CHART ── */}
      {activeTab === "chart" && (
        <div style={{ padding:"20px" }}>
          <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:16 }}>Weight vs Target</div>
          {chartWeights.length < 2
            ? <div style={{ color:"#444", fontSize:12, padding:"40px 0", textAlign:"center" }}>Log at least 2 days to see chart</div>
            : (
              <div style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", padding:"16px 8px 8px", marginBottom:20 }}>
                <svg width="100%" viewBox={`0 0 ${svgW} ${svgH}`} style={{ overflow:"visible" }}>
                  <polyline points={targetPoints.join(" ")} fill="none" stroke="#2a2a2a" strokeWidth="1" strokeDasharray="4,4" />
                  {chartPoints.length>=2 && <polyline points={chartPoints.join(" ")} fill="none" stroke="#c8f060" strokeWidth="2" />}
                  {chartEntries.map((e,i) => e.weight ? <circle key={i} cx={(i/Math.max(chartEntries.length-1,1))*svgW} cy={toY(e.weight,svgH)} r="3" fill="#c8f060" /> : null)}
                </svg>
                <div style={{ display:"flex", gap:16, marginTop:12, fontSize:10, color:"#444" }}>
                  <span><span style={{ color:"#c8f060" }}>——</span> Actual</span>
                  <span><span style={{ color:"#333" }}>- -</span> Target</span>
                </div>
              </div>
            )
          }
          <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:12 }}>Recovery Trend</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {["hrv","rhr"].map(metric => {
              const vals  = entries.filter(e=>e[metric]).slice(0,7).reverse();
              const avg   = vals.length ? (vals.reduce((s,e)=>s+e[metric],0)/vals.length).toFixed(0) : null;
              const trend = vals.length>=2 ? vals[vals.length-1][metric]-vals[0][metric] : null;
              return (
                <div key={metric} style={{ background:"#0f0f0f", border:"1px solid #1a1a1a", padding:"14px" }}>
                  <div style={{ fontSize:9, letterSpacing:2, color:"#444", textTransform:"uppercase", marginBottom:6 }}>{metric==="hrv"?"HRV 7d avg":"RHR 7d avg"}</div>
                  <div style={{ fontFamily:"'Bebas Neue'", fontSize:32, color:"#e8e4dc" }}>{avg||"—"}</div>
                  {trend!==null && <div style={{ fontSize:10, color:(metric==="hrv"?trend>0:trend<0)?"#c8f060":"#ff6b6b", marginTop:4 }}>{trend>0?"▲":"▼"} {Math.abs(trend).toFixed(0)} {metric==="hrv"?"ms":"bpm"}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── LOG ── */}
      {activeTab === "log" && (
        <div style={{ padding:"20px" }}>
          <div style={{ fontSize:10, letterSpacing:3, color:"#444", textTransform:"uppercase", marginBottom:16 }}>Entry History</div>
          {entries.length===0 && <div style={{ color:"#444", fontSize:12, padding:"40px 0", textAlign:"center" }}>No entries yet</div>}
          {entries.map(e => {
            const target = getWeightTarget(e.dayIndex);
            const delta  = e.weight ? (e.weight-target).toFixed(1) : null;
            const cl     = getChecklist(getDayOfWeek(e.date), e.dayIndex);
            const done   = cl.filter(i=>(e.checks||{})[i.id]).length;
            return (
              <div key={e.date} className="entry-row">
                <div>
                  <div style={{ fontSize:11, color:"#888", letterSpacing:1 }}>
                    {new Date(e.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    <span style={{ color:"#333", marginLeft:6 }}>Day {e.dayIndex+1}</span>
                  </div>
                  <div style={{ marginTop:4, display:"flex", gap:8, flexWrap:"wrap" }}>
                    {e.sober===true  && <span style={{ color:"#c8f060", fontSize:10 }}>✓ SOBER</span>}
                    {e.sober===false && <span style={{ color:"#ff4444", fontSize:10 }}>✗ DRANK</span>}
                    {e.feel && <span style={{ color:"#555", fontSize:10 }}>FEEL {e.feel}/10</span>}
                    <span style={{ color:done===cl.length?"#c8f060":"#444", fontSize:10 }}>{done}/{cl.length} ✓</span>
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  {e.weight && <div style={{ fontFamily:"'Bebas Neue'", fontSize:22, color:"#e8e4dc" }}>{e.weight} <span style={{ fontSize:12, color:"#444" }}>lb</span></div>}
                  {delta!==null && <div style={{ fontSize:10, color:+delta<=0?"#c8f060":"#ff6b6b" }}>{+delta<=0?"▲":"▼"} {Math.abs(delta)} vs target</div>}
                  <div style={{ fontSize:10, color:"#333", marginTop:2 }}>{e.hrv&&`HRV ${e.hrv}`} {e.rhr&&`RHR ${e.rhr}`}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
