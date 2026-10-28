// Generates animated SVGs of the GitHub contribution calendar.
// Usage: node scripts/generate.mjs [outDir] [login]
// Needs GITHUB_TOKEN (falls back to `gh auth token` locally).

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2] || "dist";
const login = process.argv[3] || process.env.GITHUB_REPOSITORY_OWNER || "dudssecco";
const token = process.env.GITHUB_TOKEN || execSync("gh auth token").toString().trim();

const QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date weekday contributionCount contributionLevel } }
      }
    }
  }
}`;

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const THEMES = {
  light: {
    levels: ["#ebedf0", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
    text: "#1f2328",
    muted: "#59636e",
  },
  dark: {
    levels: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    text: "#f0f6fc",
    muted: "#9198a1",
  },
};

const PERIOD = 12; // seconds per animation loop
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const r = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toLocaleString("en-US");

async function fetchCalendar() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w, wi) =>
    w.contributionDays.map((d) => ({
      date: d.date,
      week: wi,
      weekday: d.weekday,
      count: d.contributionCount,
      level: LEVEL[d.contributionLevel] ?? 0,
    })),
  );
  return { total: cal.totalContributions, weeks, days: weeks.flat() };
}

function stats(days) {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today not having commits yet shouldn't break the current streak.
  let i = days.length - 1;
  if (days[i].count === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].count > 0) current++, i--;
  const best = days.reduce((a, b) => (b.count > a.count ? b : a));
  return { longest, current, best, max: Math.max(1, best.count) };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function svg(width, height, css, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
text{font-family:${FONT}}
${css}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>
${body}
</svg>
`;
}

// Classic grid: cells drop in as a diagonal wave, hold, then wave out.
function grid(data, s, t) {
  const pitch = 14;
  const size = 11;
  const left = 34;
  const top = 72;
  const width = left + data.weeks.length * pitch + 12;
  const height = top + 7 * pitch + 30;

  const css = `.c{transform-box:fill-box;transform-origin:center;animation:drop ${PERIOD}s cubic-bezier(.3,1.5,.6,1) infinite both}
@keyframes drop{0%{opacity:0;transform:translateY(-16px) scale(.3)}7%{opacity:1;transform:none}84%{opacity:1;transform:none}92%,100%{opacity:0;transform:translateY(10px) scale(.3)}}`;

  let body = `<text x="${left}" y="24" font-size="16" font-weight="600" fill="${t.text}">${fmt(data.total)} contributions in the last year</text>
<text x="${left}" y="46" font-size="12" fill="${t.muted}">Longest streak ${s.longest} days  ·  Current streak ${s.current} days  ·  Best day ${s.best.count} (${s.best.date})</text>
`;

  let lastMonth = -1;
  for (const w of data.weeks) {
    const m = Number(w[0].date.slice(5, 7)) - 1;
    if (m !== lastMonth && Number(w[0].date.slice(8)) <= 7) {
      body += `<text x="${left + w[0].week * pitch}" y="${top - 8}" font-size="10" fill="${t.muted}">${MONTHS[m]}</text>\n`;
    }
    lastMonth = m;
  }
  for (const [d, label] of [[1, "Mon"], [3, "Wed"], [5, "Fri"]]) {
    body += `<text x="0" y="${top + d * pitch + 9}" font-size="10" fill="${t.muted}">${label}</text>\n`;
  }

  for (const d of data.days) {
    const delay = r((d.week + d.weekday * 0.7) * 0.03);
    body += `<rect class="c" x="${left + d.week * pitch}" y="${top + d.weekday * pitch}" width="${size}" height="${size}" rx="2" fill="${t.levels[d.level]}" style="animation-delay:${delay}s"><title>${d.count} on ${d.date}</title></rect>\n`;
  }

  const lx = width - 12 - 5 * pitch - 34;
  body += `<text x="${lx - 30}" y="${height - 8}" font-size="10" fill="${t.muted}">Less</text>\n`;
  t.levels.forEach((c, i) => {
    body += `<rect x="${lx + i * pitch}" y="${height - 18}" width="${size}" height="${size}" rx="2" fill="${c}"/>\n`;
  });
  body += `<text x="${lx + 5 * pitch + 4}" y="${height - 8}" font-size="10" fill="${t.muted}">More</text>\n`;

  return svg(width, height, css, body);
}

// Isometric skyline: each day is a tower whose height is sqrt(count).
function skyline(data, s, t) {
  const A = [9, 2.2]; // one week step
  const B = [-4.5, 3.6]; // one weekday step
  const f = 0.82;
  const maxH = 95;
  const ox = 7 * 4.5 + 20;
  const oy = 70 + maxH;
  const width = Math.ceil(ox + data.weeks.length * A[0] + 20);
  const height = Math.ceil(oy + data.weeks.length * A[1] + 7 * B[1] + 24);

  const css = `.b{transform-box:fill-box;transform-origin:50% 100%;animation:grow ${PERIOD}s cubic-bezier(.2,.9,.3,1.2) infinite both}
@keyframes grow{0%{transform:scaleY(0)}10%{transform:scaleY(1)}86%{transform:scaleY(1)}95%,100%{transform:scaleY(0)}}`;

  let body = `<text x="20" y="24" font-size="16" font-weight="600" fill="${t.text}">Contribution skyline</text>
<text x="20" y="46" font-size="12" fill="${t.muted}">${data.days[0].date} → ${data.days.at(-1).date}  ·  ${fmt(data.total)} contributions</text>
`;

  const pt = (x, y) => `${r(x)},${r(y)}`;
  const sorted = [...data.days].sort((a, b) => a.week + a.weekday - (b.week + b.weekday) || a.week - b.week);
  for (const d of sorted) {
    const px = ox + d.week * A[0] + d.weekday * B[0];
    const py = oy + d.week * A[1] + d.weekday * B[1];
    const p0 = [px, py];
    const p1 = [px + f * A[0], py + f * A[1]];
    const p2 = [p1[0] + f * B[0], p1[1] + f * B[1]];
    const p3 = [px + f * B[0], py + f * B[1]];
    const h = d.level === 0 ? 1.5 : 4 + Math.sqrt(d.count / s.max) * (maxH - 4);
    const up = ([x, y]) => [x, y - h];
    const c = t.levels[d.level];
    const delay = r(d.week * 0.035 + d.weekday * 0.02);
    body += `<g class="b" style="animation-delay:${delay}s">`;
    body += `<polygon points="${[p1, p2, up(p2), up(p1)].map((p) => pt(...p)).join(" ")}" fill="${shade(c, 0.78)}"/>`;
    body += `<polygon points="${[p3, p2, up(p2), up(p3)].map((p) => pt(...p)).join(" ")}" fill="${shade(c, 0.6)}"/>`;
    body += `<polygon points="${[p0, p1, p2, p3].map((p) => pt(...up(p))).join(" ")}" fill="${c}"/>`;
    body += `<title>${d.count} on ${d.date}</title></g>\n`;
  }

  return svg(width, height, css, body);
}

// Year ring: 365 radial bars that sweep in clockwise.
function ring(data, s, t) {
  const size = 440;
  const cx = size / 2;
  const cy = size / 2;
  const r0 = 78;
  const maxLen = 110;
  const n = data.days.length;

  const css = `.r{stroke-dasharray:1;animation:sweep ${PERIOD}s ease-out infinite both}
@keyframes sweep{0%{stroke-dashoffset:1}9%{stroke-dashoffset:0}86%{stroke-dashoffset:0}95%,100%{stroke-dashoffset:-1}}`;

  let body = "";
  let lastMonth = -1;
  data.days.forEach((d, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const len = d.level === 0 ? 3 : 8 + Math.sqrt(d.count / s.max) * (maxLen - 8);
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    const delay = r((i / n) * 2.2);
    body += `<line class="r" pathLength="1" x1="${r(cx + cos * r0)}" y1="${r(cy + sin * r0)}" x2="${r(cx + cos * (r0 + len))}" y2="${r(cy + sin * (r0 + len))}" stroke="${t.levels[d.level]}" stroke-width="2.4" stroke-linecap="round" style="animation-delay:${delay}s"><title>${d.count} on ${d.date}</title></line>\n`;

    const m = Number(d.date.slice(5, 7)) - 1;
    if (m !== lastMonth && Number(d.date.slice(8)) === 1) {
      const rr = r0 + maxLen + 18;
      body += `<text x="${r(cx + cos * rr)}" y="${r(cy + sin * rr + 4)}" font-size="10" text-anchor="middle" fill="${t.muted}">${MONTHS[m]}</text>\n`;
    }
    lastMonth = m;
  });

  body += `<text x="${cx}" y="${cy - 2}" font-size="30" font-weight="700" text-anchor="middle" fill="${t.text}">${fmt(data.total)}</text>
<text x="${cx}" y="${cy + 18}" font-size="11" text-anchor="middle" fill="${t.muted}">contributions</text>
<text x="${cx}" y="${cy + 34}" font-size="11" text-anchor="middle" fill="${t.muted}">streak ${s.current}d · best ${s.longest}d</text>
`;

  return svg(size, size, css, body);
}

const data = await fetchCalendar();
const s = stats(data.days);
mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  const suffix = name === "light" ? "" : `-${name}`;
  writeFileSync(join(outDir, `contrib-grid${suffix}.svg`), grid(data, s, t));
  writeFileSync(join(outDir, `contrib-skyline${suffix}.svg`), skyline(data, s, t));
  writeFileSync(join(outDir, `contrib-ring${suffix}.svg`), ring(data, s, t));
}
console.log(`${login}: ${data.total} contributions, longest streak ${s.longest}, current ${s.current} → ${outDir}/`);
