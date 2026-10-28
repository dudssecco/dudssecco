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
    line: "#d1d9e0",
    term: { bg: "#f6f8fa", border: "#d1d9e0", prompt: "#1a7f37", text: "#1f2328", key: "#59636e", value: "#0969da" },
  },
  dark: {
    levels: ["#151b23", "#033a16", "#196c2e", "#2ea043", "#56d364"],
    text: "#f0f6fc",
    muted: "#9198a1",
    line: "#3d444d",
    term: { bg: "#0d1117", border: "#3d444d", prompt: "#3fb950", text: "#f0f6fc", key: "#9198a1", value: "#79c0ff" },
  },
};

const PERIOD = 12; // seconds per animation loop
const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONO = `ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const r = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toLocaleString("en-US");

const LANG_QUERY = `query($login: String!) {
  user(login: $login) {
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      nodes { languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } } }
    }
  }
}`;

async function graphql(query) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user;
}

async function fetchCalendar() {
  const user = await graphql(QUERY);
  const cal = user.contributionsCollection.contributionCalendar;
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

// Bytes per language across public, non-fork repos owned by the user.
async function fetchLanguages() {
  const user = await graphql(LANG_QUERY);
  const totals = new Map();
  for (const repo of user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      const cur = totals.get(node.name) || { name: node.name, color: node.color || "#8b949e", size: 0 };
      cur.size += size;
      totals.set(node.name, cur);
    }
  }
  return [...totals.values()].sort((a, b) => b.size - a.size);
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
  const byWeekday = Array(7).fill(0);
  for (const d of days) byWeekday[d.weekday] += d.count;
  const busiest = byWeekday.indexOf(Math.max(...byWeekday));
  const active = days.filter((d) => d.count > 0).length;
  return { longest, current, best, max: Math.max(1, best.count), byWeekday, busiest, active };
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

// Fake terminal that types the yearly stats line by line.
function terminal(data, s, t) {
  const width = 620;
  const lh = 24;
  const top = 64;
  const cw = 8.4; // monospace advance at 14px
  const pct = (sec) => r((sec / PERIOD) * 100);

  const cmd = `git log --author=${login} --since="1 year ago" --stats`;
  const rows = [
    ["contributions", fmt(data.total)],
    ["longest streak", `${s.longest} days`],
    ["current streak", `${s.current} days`],
    ["best day", `${s.best.count} on ${s.best.date}`],
    ["busiest weekday", WEEKDAYS[s.busiest]],
    ["active days", `${s.active} of ${data.days.length}`],
  ];
  const height = top + (rows.length + 2) * lh + 8;

  // [start, duration, chars] per line, in seconds.
  const timing = [[0.4, 1.8, cmd.length + 2]];
  rows.forEach((_, i) => timing.push([2.7 + i * 0.35, 0.25, 1]));
  timing.push([2.7 + rows.length * 0.35 + 0.2, 0.01, 1]);

  let css = `text{font-family:${MONO};font-size:14px}
.cur{animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
`;
  timing.forEach(([start, dur, n], i) => {
    css += `.l${i}{animation:l${i} ${PERIOD}s linear infinite both}
@keyframes l${i}{0%,${pct(start)}%{clip-path:inset(0 100% 0 0);opacity:1;animation-timing-function:steps(${n})}${pct(start + dur)}%{clip-path:inset(0 0 0 0)}90%{opacity:1}94%,100%{clip-path:inset(0 0 0 0);opacity:0}}
`;
  });

  let body = `<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" fill="${t.term.bg}" stroke="${t.term.border}"/>
<path d="M.5 34.5h${width - 1}" stroke="${t.term.border}"/>
<circle cx="20" cy="17.5" r="6" fill="#ff5f57"/><circle cx="40" cy="17.5" r="6" fill="#febc2e"/><circle cx="60" cy="17.5" r="6" fill="#28c840"/>
<text x="${width / 2}" y="22" text-anchor="middle" fill="${t.term.key}" style="font-size:12px">${login} — zsh</text>
<text class="l0" x="20" y="${top}" fill="${t.term.text}"><tspan fill="${t.term.prompt}">$</tspan> ${cmd.replace(/"/g, "&quot;")}</text>
`;
  rows.forEach(([k, v], i) => {
    body += `<text class="l${i + 1}" x="36" y="${top + (i + 1) * lh}" fill="${t.term.key}">${k}<tspan x="${36 + 18 * cw}" fill="${t.term.value}">${v}</tspan></text>\n`;
  });
  const last = rows.length + 1;
  body += `<g class="l${last}"><text x="20" y="${top + last * lh}" fill="${t.term.prompt}">$</text><rect class="cur" x="${20 + 2 * cw}" y="${top + last * lh - 13}" width="${cw}" height="17" fill="${t.term.text}"/></g>\n`;

  return svg(width, height, css, body);
}

function monthTicks(days, xOf, y, t) {
  let out = "";
  let last = -1;
  days.forEach((d, i) => {
    const m = Number(d.date.slice(5, 7)) - 1;
    if (m !== last && Number(d.date.slice(8)) === 1) {
      out += `<text x="${r(xOf(i))}" y="${y}" font-size="10" fill="${t.muted}">${MONTHS[m]}</text>\n`;
    }
    last = m;
  });
  return out;
}

// Running total over the year; the line draws itself, then the area fills in.
function cumulative(data, s, t, id) {
  const width = 788;
  const height = 250;
  const [x0, x1, y0, y1] = [44, 760, 206, 70];
  const n = data.days.length;
  const sum = data.days.reduce((a, d) => a + d.count, 0) || 1;
  const k = data.total / sum; // daily counts don't always add up to GitHub's total
  let acc = 0;
  const pts = data.days.map((d, i) => {
    acc += d.count * k;
    return [x0 + (i / (n - 1)) * (x1 - x0), y0 - (acc / Math.max(1, data.total)) * (y0 - y1)];
  });
  const line = "M" + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join("L");
  const area = `${line}L${x1} ${y0}L${x0} ${y0}Z`;

  const months = new Map();
  for (const d of data.days) months.set(d.date.slice(0, 7), (months.get(d.date.slice(0, 7)) || 0) + d.count);
  const [bestMonth, bestCount] = [...months].reduce((a, b) => (b[1] > a[1] ? b : a));
  const bm = `${MONTHS[Number(bestMonth.slice(5)) - 1]} ${bestMonth.slice(0, 4)}`;

  const css = `.ln{stroke-dasharray:1;animation:draw ${PERIOD}s ease-in-out infinite both}
.ar{animation:fill ${PERIOD}s ease infinite both}
.end{animation:fill ${PERIOD}s ease infinite both;animation-delay:.4s}
@keyframes draw{0%{stroke-dashoffset:1;opacity:1}32%{stroke-dashoffset:0}88%{opacity:1}95%,100%{stroke-dashoffset:0;opacity:0}}
@keyframes fill{0%,26%{opacity:0}38%{opacity:1}88%{opacity:1}95%,100%{opacity:0}}`;

  let body = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${t.levels[3]}" stop-opacity=".45"/><stop offset="1" stop-color="${t.levels[3]}" stop-opacity="0"/></linearGradient></defs>
<text x="${x0}" y="24" font-size="16" font-weight="600" fill="${t.text}">Cumulative contributions</text>
<text x="${x0}" y="46" font-size="12" fill="${t.muted}">Busiest month ${bm} with ${fmt(bestCount)}  ·  ${r(data.total / 52)} per week on average</text>
`;
  for (const f of [0, 0.5, 1]) {
    const y = y0 - f * (y0 - y1);
    body += `<path d="M${x0} ${r(y)}H${x1}" stroke="${t.line}" stroke-dasharray="${f ? "3 4" : "0"}"/><text x="${x0 - 8}" y="${r(y + 4)}" font-size="10" text-anchor="end" fill="${t.muted}">${fmt(Math.round(f * data.total))}</text>\n`;
  }
  body += monthTicks(data.days, (i) => x0 + (i / (n - 1)) * (x1 - x0), y0 + 18, t);
  body += `<path class="ar" d="${area}" fill="url(#${id})"/>
<path class="ln" d="${line}" pathLength="1" fill="none" stroke="${t.levels[4]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
<g class="end"><circle cx="${x1}" cy="${y1}" r="4.5" fill="${t.levels[4]}"/><text x="${x1 - 10}" y="${y1 - 10}" font-size="13" font-weight="600" text-anchor="end" fill="${t.text}">${fmt(data.total)}</text></g>
`;
  return svg(width, height, css, body);
}

// Heart-monitor trace: one beat per week, height = sqrt(weekly total).
function pulse(data, s, t, id) {
  const width = 788;
  const height = 210;
  const [x0, x1, base] = [24, 764, 152];
  const totals = data.weeks.map((w) => w.reduce((a, d) => a + d.count, 0));
  const maxW = Math.max(1, ...totals);
  const peak = totals.indexOf(maxW);
  const sw = (x1 - x0) / totals.length;

  let d = `M${x0} ${base}`;
  totals.forEach((v, i) => {
    const a = v === 0 ? 0 : 6 + Math.sqrt(v / maxW) * 84;
    const x = x0 + i * sw;
    d += `L${r(x + 0.3 * sw)} ${base}L${r(x + 0.42 * sw)} ${r(base - a)}L${r(x + 0.56 * sw)} ${r(base + a * 0.3)}L${r(x + 0.68 * sw)} ${base}L${r(x + sw)} ${base}`;
  });

  const css = `.tr{stroke-dasharray:.025 .975;animation:run 7s linear infinite}
@keyframes run{from{stroke-dashoffset:.025}to{stroke-dashoffset:-.975}}`;

  let body = `<defs><filter id="${id}" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="2"/></filter></defs>
<text x="${x0}" y="24" font-size="16" font-weight="600" fill="${t.text}">Weekly pulse</text>
<text x="${x0}" y="46" font-size="12" fill="${t.muted}">Peak week of ${data.weeks[peak][0].date} with ${fmt(maxW)} contributions</text>
<path d="${d}" fill="none" stroke="${t.levels[2]}" stroke-opacity=".45" stroke-width="1.5" stroke-linejoin="round"/>
<path class="tr" d="${d}" pathLength="1" fill="none" stroke="${t.levels[4]}" stroke-opacity=".7" stroke-width="5" stroke-linejoin="round" filter="url(#${id})"/>
<path class="tr" d="${d}" pathLength="1" fill="none" stroke="${t.levels[4]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
`;
  body += monthTicks(data.days, (i) => x0 + (i / 7) * sw, height - 10, t);
  return svg(width, height, css, body);
}

// Total per weekday as bars that grow in one after another.
function weekdays(data, s, t) {
  const width = 388;
  const height = 270;
  const [x0, barMax, top, lh] = [56, 250, 76, 26];
  const max = Math.max(1, ...s.byWeekday);

  const css = `.w{transform-box:fill-box;transform-origin:0 50%;animation:bar ${PERIOD}s cubic-bezier(.2,.8,.3,1) infinite both}
.v{animation:val ${PERIOD}s ease infinite both}
@keyframes bar{0%{transform:scaleX(0)}10%{transform:scaleX(1)}88%{transform:scaleX(1)}95%,100%{transform:scaleX(0)}}
@keyframes val{0%,8%{opacity:0}12%{opacity:1}88%{opacity:1}94%,100%{opacity:0}}`;

  let body = `<text x="20" y="24" font-size="16" font-weight="600" fill="${t.text}">By weekday</text>
<text x="20" y="46" font-size="12" fill="${t.muted}">Most active on ${WEEKDAYS[s.busiest]}s</text>
`;
  s.byWeekday.forEach((v, i) => {
    const y = top + i * lh;
    const w = Math.max(3, (v / max) * barMax);
    const delay = r(i * 0.12);
    body += `<text x="20" y="${y + 12}" font-size="11" fill="${t.muted}">${WEEKDAYS[i].slice(0, 3)}</text>
<rect class="w" x="${x0}" y="${y}" width="${r(w)}" height="16" rx="4" fill="${t.levels[i === s.busiest ? 4 : 2]}" style="animation-delay:${delay}s"/>
<text class="v" x="${r(x0 + w + 8)}" y="${y + 12}" font-size="11" fill="${t.text}" style="animation-delay:${delay}s">${fmt(v)}</text>
`;
  });
  return svg(width, height, css, body);
}

// Language share by bytes: stacked bar fills left to right, then the legend.
function languages(langs, t) {
  const width = 388;
  const height = 270;
  const [x0, x1, barY] = [20, 368, 70];
  const total = langs.reduce((a, l) => a + l.size, 0) || 1;
  const top = langs.slice(0, 7);
  const rest = langs.slice(7).reduce((a, l) => a + l.size, 0);
  if (rest) top.push({ name: "Other", color: "#8b949e", size: rest });

  const css = `.s{transform-box:fill-box;transform-origin:0 50%;animation:seg ${PERIOD}s ease-out infinite both}
.g{animation:leg ${PERIOD}s ease infinite both}
@keyframes seg{0%{transform:scaleX(0)}5%{transform:scaleX(1)}88%{transform:scaleX(1)}95%,100%{transform:scaleX(0)}}
@keyframes leg{0%{opacity:0;transform:translateY(6px)}5%{opacity:1;transform:none}88%{opacity:1}94%,100%{opacity:0}}`;

  let body = `<text x="20" y="24" font-size="16" font-weight="600" fill="${t.text}">Top languages</text>
<text x="20" y="46" font-size="12" fill="${t.muted}">By code size across public repositories</text>
<clipPath id="lc"><rect x="${x0}" y="${barY}" width="${x1 - x0}" height="10" rx="5"/></clipPath>
<g clip-path="url(#lc)">
`;
  let x = x0;
  top.forEach((l, i) => {
    const w = (l.size / total) * (x1 - x0);
    body += `<rect class="s" x="${r(x)}" y="${barY}" width="${r(w + 0.5)}" height="10" fill="${l.color}" style="animation-delay:${r(i * 0.25)}s"/>\n`;
    x += w;
  });
  body += "</g>\n";
  top.forEach((l, i) => {
    const cx = x0 + (i % 2) * 180;
    const cy = barY + 44 + Math.floor(i / 2) * 30;
    body += `<g class="g" style="animation-delay:${r(0.6 + i * 0.12)}s"><circle cx="${cx + 5}" cy="${cy - 4}" r="5" fill="${l.color}"/><text x="${cx + 18}" y="${cy}" font-size="12" font-weight="600" fill="${t.text}">${l.name}</text><text x="${cx + 160}" y="${cy}" font-size="12" text-anchor="end" fill="${t.muted}">${((l.size / total) * 100).toFixed(1)}%</text></g>\n`;
  });
  if (!top.length) body += `<text x="20" y="${barY + 40}" font-size="12" fill="${t.muted}">No public repositories yet</text>\n`;
  return svg(width, height, css, body);
}

const [data, langs] = await Promise.all([fetchCalendar(), fetchLanguages()]);
const s = stats(data.days);
mkdirSync(outDir, { recursive: true });
for (const [name, t] of Object.entries(THEMES)) {
  const suffix = name === "light" ? "" : `-${name}`;
  const files = {
    grid: grid(data, s, t),
    skyline: skyline(data, s, t),
    ring: ring(data, s, t),
    terminal: terminal(data, s, t),
    cumulative: cumulative(data, s, t, `cg${suffix}`),
    pulse: pulse(data, s, t, `pg${suffix}`),
    weekdays: weekdays(data, s, t),
    languages: languages(langs, t),
  };
  for (const [file, content] of Object.entries(files)) writeFileSync(join(outDir, `contrib-${file}${suffix}.svg`), content);
}
console.log(`${login}: ${data.total} contributions, longest streak ${s.longest}, current ${s.current}, ${langs.length} languages → ${outDir}/`);
