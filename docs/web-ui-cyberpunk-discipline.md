# Web UI Cyberpunk Maximalism — Discipline & Design Language

Source-of-truth for the web app's default visual language (the `neon` style + `neon-tokyo` palette in the 21-combo theming system from [`web-ui-theme-system.md`](./web-ui-theme-system.md)).

Authored 2026-05-29 during the Swift→Web UI pivot.

---

## The discipline rules (read these first)

Cyberpunk maximalism rewards intentionality. These rules are the difference
between "looks like a product" and "looks like a Codepen demo."

- **Motion is keyed to liveness.** Only in-flight spans animate (pulse).
  Completed spans glow but stay still. Errors strobe once on arrival, then
  settle. Idle data does not animate. The eye should be drawn to what's
  actually live — animation is informational, not decorative.
- **Glow is keyed to identity.** Each element kind has one glow level; don't
  stack. A bar gets a glow; a label inside the bar does not. Selection adds
  intensity, not a second glow layer.
- **Reserve magenta for action and selection.** Magenta is the loudest color
  in the system — overuse murders the hierarchy. Cyan is the default
  informational tone; magenta is "this is what you click" or "this is what's
  selected." If everything is magenta, nothing is.
- **Density still wins on working surfaces.** Trace lists run to hundreds of
  rows. One selected row glows; the rest are tinted but quiet. If every row
  glows, it's noise.
- **Mono everywhere is a commitment, not a default.** Don't reach for a
  "friendlier" font when a layout problem appears. Fix the layout.
- **The waterfall must remain readable.** Bars over ~6px tall carry mono
  labels, truncated cleanly. Glow goes on the bar; never on the label text
  (label glow destroys legibility at trace-row density).

## Design tokens

Define these once as CSS variables. Restyle shadcn primitives through them.

### Colors

```css
/* surface ramp — near-black with slight purple tint */
--bg-base:        #07000f;
--bg-panel:       #0c0418;
--bg-elevated:    #140826;
--border-hairline: #2a1450;

/* family palette — each span family gets one color */
--cyan:    #5cf9ff;   /* claude_code.interaction, info, default tone */
--purple:  #b76eff;   /* claude_code.llm_request */
--magenta: #ff2cb1;   /* claude_code.tool, ACTION, SELECTION */
--orange:  #ff8c5a;   /* codex_exec.* — visually distinct from claude family */

/* semantic — status overrides family */
--green:   #4cffa6;   /* success */
--amber:   #ffd166;   /* running (pulses) */
--red:     #ff5577;   /* error (strobe-once on arrival) */

/* text */
--text:        #e6e1ff;
--text-muted:  #8a7fb0;
--text-dim:    #5b527a;  /* timestamps, IDs, // comments */
```

### Glow utility

One mixin, applied at three intensities. Never stack.

```css
.glow-soft   { box-shadow: 0 0 8px  var(--c), inset 0 0 0 1px var(--c)40; }
.glow-medium { box-shadow: 0 0 14px var(--c), 0 0 32px var(--c)30, inset 0 0 0 1px var(--c); }
.glow-strong { box-shadow: 0 0 20px var(--c), 0 0 48px var(--c)50, inset 0 0 0 1px var(--c); }
```

Where `--c` is the family color of the element. Selection = bump one intensity
level, not add a second glow.

### Typography

Avoid the obvious cyberpunk defaults. The skill explicitly warns against
converging on common choices.

- **Display / headings:** Departure Mono (Helena Zhang, free) — distinctive
  pixel-edge mono that captures the terminal aesthetic without being a meme.
  Fallback: JetBrains Mono Bold in uppercase with `letter-spacing: 0.15em`.
- **Body / data:** Geist Mono or JetBrains Mono — clean, legible at
  small sizes, excellent for IDs and timestamps.
- **Single-family option** if you want maximum cohesion: Departure Mono for
  everything, varying only weight and case.

Sizes: 11 / 12 / 13 / 16 / 28 / 56px. The 28 and 56 are for hero numerals
only (see below); 12–13 is the workhorse for tables and inspector rows.

### The "terminal comment" annotation pattern

The reference's `// Live preview` and `// complete` style is core to the
aesthetic. Use it for every secondary metadata in the app:

- Session metadata: `// 3 traces · 29 spans`
- Span timing: `// 1075ms · 510 in · 14 out`
- Identity rows in the inspector: `// req_011CbX36G5qQe-Frxg5GoxSM3`
- Empty/loading states: `// awaiting spans...`

Render as `var(--text-dim)` mono, prefixed with `// ` literally.

### Hero numerals (the big-number pattern)

The reference's `2.40s` treatment is your answer to several problems at once.

Pattern: huge family-colored monospace numeral + tiny muted unit suffix +
optional `// label` underneath.

Apply to:
- Total trace duration at the top of the inspector (the hero of the trace).
- Token magnitudes. This is the buried-524k-cache-hit fix from earlier
  rounds. `cache_read_tokens: 524913` becomes `524.9k` at 56px in cyan, with
  `tokens · cache_read` at 11px muted underneath. Same treatment for
  `input_tokens` / `output_tokens` / `ttft_ms`. Three or four of these become
  the inspector's header band.
- Per-session aggregates in the metrics deck (total tokens, total duration,
  error rate — **not cost**).

## Component application

### Waterfall (the headline)

- Each span = a horizontal bar on the time axis, colored by span family.
- Bars carry `.glow-soft` by default. Running bars carry `.glow-medium` and a
  Motion-driven opacity pulse (0.7 → 1.0 → 0.7 over 1.5s, repeating).
- Hover: bar gets `.glow-strong`; ancestors get `.glow-medium`; non-ancestor
  siblings dim to 40% opacity. Re-style in one Canvas/SVG pass — this is the
  reason the BUILD-PLAN picked a custom timeline over an off-the-shelf
  flame-graph component.
- Label inside the bar: mono, no glow, `--text` solid, truncated with ellipsis.
- Time-axis ticks: mono cyan at `--text-dim` weight; major ticks at full cyan.
- **Cross-process edge celebration** (GSAP, one-time): when the cross-process
  tree first connects for a session (VOI-339 landing), draw a sweep line in
  `--magenta` from the parent Claude tool span to the spawned `codex_exec`
  span, then leave a permanent glowing ligature between them. This is the
  earned dopamine moment — it fires once per new cross-process edge, never on
  idle redraws.

### Sessions / traces list

- Bordered cards on `--bg-panel`, hairline border in family color at 30% alpha.
- Selected row: left edge becomes a 2px glowing magenta bar (the "selection
  reserved for magenta" rule made literal). Background tint at 8% magenta.
  No hot-blue fill anywhere.
- Status: small family-colored dot glyph (●) with the same family color as
  the row's dominant span. Running → amber, pulsing. Error → red, strobed once
  on first render then static. Define the dot legend in a tooltip in the
  sidebar header.
- Metadata: terminal-comment styling. `// 9 spans · 20.307s` in `--text-dim`.
- Vertical tick connector between parent and child rows when one row is a
  cross-process descendant of another — colored to match the child's family.
  This is the second translation from the reference: the eye sees the lineage
  in the list before clicking into the waterfall.

### Inspector (right pane)

- Top band: 3–4 hero numerals horizontally. Duration in cyan, input tokens in
  cyan, output tokens in cyan, ttft in purple. Each with its `// label` below.
- Attribute groups in their own bordered cards on `--bg-elevated`:
  - **REQUEST** (cyan dot + label) — model, tokens, ttft, duration.
  - **RESPONSE** (purple dot) — stop_reason, finish_reasons, response.id.
  - **IDENTITY** (dim cyan dot) — request_id, session.id, organization.id.
    Terminal-comment styled. Hover reveals a copy-to-clipboard glyph in
    magenta.
  - **ENVIRONMENT** (dim purple dot) — terminal.type, gen_ai.system, speed.
- Group headers: ALL-CAPS Departure Mono with letter-spacing, colored dot
  prefix matching the group's family.
- No tooltips explaining schema. The `?` affordance from the build plan is at
  most a single icon per group, opening a popover only on click.

### Menu-bar pulse (the live tray)

- Canvas, ~120×22px, driven by a GSAP timeline that reads from the live span
  stream.
- Default state: a flowing cyan waveform, low amplitude.
- Span in-flight: amplitude rises; tint shifts toward the family color of the
  dominant active span (purple if mostly LLM calls, magenta if tool calls,
  orange if codex_exec spans running).
- Error in last 30 seconds: a red strobe pulse traverses the waveform once,
  then color returns to normal.
- Click → expands a small native popover with the most recent 3 traces, all
  rendered in this same aesthetic.

### Empty/loading states

- Use `.redacted(reason: .placeholder)` style — neon-tinted skeleton bars at
  20% opacity, with the terminal-comment line above them:
  `// awaiting spans from ClickHouse...`
- For first launch (no data ever), one Aceternity-style animated grid
  background, a single big terminal-comment block explaining the empty state,
  and a magenta "RUN cc-launch.sh" CTA styled like the reference's "RUN QUERY"
  button.

## Library additions to the stack

On top of what's already in the web foundation packet (React + TS + Vite +
Tauri 2 + SWR + react-virtuoso + Zustand + Motion + GSAP + lucide-react), add
for this aesthetic:

- **Aceternity UI** — animated beams (use for the cross-process edge sweep),
  glow buttons, gradient borders, animated grid backgrounds. The reference's
  "RUN QUERY" button is essentially an Aceternity glow button. Use sparingly,
  primarily on the empty/onboarding state and the GSAP celebration.
  **Copy-paste pattern, not a runtime dep — audit individual pieces.**
- **Magic UI** — animated dot-grid background. Fixed-position, behind content,
  at very low opacity (2–4%) — provides texture without competing. Same
  copy-paste-and-audit model.
- **cmdk** (Paco Coursey's command palette) — ⌘K to jump between traces,
  sessions, filters. Styled in the neon aesthetic (magenta selection, cyan
  results, mono everything).
- **@paper-design/shaders-react** — optional, for an ambient scanline or noise
  shader on the empty/onboarding state only. Not on working surfaces.

Skip: any chart library that ships its own theming opinions (Recharts looks
wrong here without a fight; ECharts is similar). uPlot is fine because it
renders to canvas and you control every pixel. Swift Charts is moot — you've
pivoted to web.

## Pitfalls specific to this aesthetic

- **Over-glowing.** If two adjacent elements both have `.glow-medium`, you've
  doubled the visual weight without doubling the meaning. Use `.glow-soft` for
  default, `.glow-medium` for hovered/active, `.glow-strong` for selected.
- **Pulsing completed data.** Easy mistake: bind the pulse animation to
  "span is rendered" instead of "span.status == 'running'." Watch for this in
  the waterfall and the trace list.
- **Magenta creep.** Every developer wants their button magenta because magenta
  looks great. Resist. One magenta CTA per surface. Selection state. That's it.
- **Label glow.** Glow on text destroys legibility. If a label is hard to read,
  the fix is contrast or size, not glow.
- **Generic AI-cyberpunk drift.** The skill warns against converging on common
  choices. If the result looks like every other "AI agent" landing page (deep
  purple gradient + Space Grotesk + glassmorphism), the aesthetic has drifted.
  The corrective is: mono everywhere, terminal-comment annotations, hero
  numerals, near-black not deep purple.
