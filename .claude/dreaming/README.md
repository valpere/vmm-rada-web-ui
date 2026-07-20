# Dreaming — vmm-rada-web-ui project

Project-specific dreaming pass. Виявляє drift від `context-essentials.md`,
recurring `/fix-review` теми, stale plans, agent-memory health.

## Запуск

Manually:
```bash
~/wrk/projects/vmm-rada-web-ui/vmm-rada-web-ui/.claude/dreaming/dreaming.sh
```

Scheduled — **systemd user timer** (recommended, catches up missed runs).
Create **two** unit files at the paths shown below:

`~/.config/systemd/user/dreaming-vmm-rada-web-ui.service`:

```ini
[Service]
Type=oneshot
ExecStart=/home/val/wrk/projects/vmm-rada-web-ui/vmm-rada-web-ui/.claude/dreaming/dreaming.sh
# `claude` CLI needs AI_PROVIDER_API_KEY (and any other secrets the script
# uses). systemd user units start with a near-empty environment, so the
# script's reliance on a parent shell loading .env doesn't apply here —
# load it explicitly. EnvironmentFile= treats the file as missing-OK only
# when prefixed with `-`, which is what we want during first-run setup.
EnvironmentFile=-%h/wrk/projects/vmm-rada-web-ui/vmm-rada-web-ui/.env
# Use the script's own log directory (~/.cache/vmm-rada-web-ui/, mode 0700)
# rather than /tmp — /tmp is world-readable and could leak secrets if the
# pass ever logs prompt content, env values, or stack traces.
StandardOutput=append:%h/.cache/vmm-rada-web-ui/dreaming-systemd.log
StandardError=append:%h/.cache/vmm-rada-web-ui/dreaming-systemd.log
```

`~/.config/systemd/user/dreaming-vmm-rada-web-ui.timer`:

```ini
[Unit]
Description=Weekly vmm-rada-web-ui dreaming pass

[Timer]
# Clear of other Sunday dreaming passes: user-level 03:00, vmm-rada
# backend 04:00, llm-wiki 05:00, lance-agent 06:00, growthcore 06:30,
# depl-orch 07:00. Nominal — комп зазвичай вимкнений.
OnCalendar=Sun 05:30
# Catch up the most recent missed run at next login.
Persistent=true
# Spread bursty boot-time catchups.
RandomizedDelaySec=5min

[Install]
WantedBy=timers.target
```

Activate:

```bash
systemctl --user daemon-reload
systemctl --user enable --now dreaming-vmm-rada-web-ui.timer

# Optional but recommended: keeps the user-level systemd manager running
# even when you're logged out, so the timer fires on overnight catchup
# instead of waiting for your next login session. Likely already enabled
# if vmm-rada backend's own dreaming timer is active — check first with
# `loginctl show-user "$USER" | grep Linger` before re-running.
loginctl enable-linger "$USER"
```

**Чому НЕ cron:** vanilla cron не догоняє пропущених runs — якщо комп
вимкнений у Sun 06:00, run просто втрачається. systemd `Persistent=true`
запам'ятовує **останній** пропущений елапс і фаєриться на наступному
login (multi-week downtime ≠ multiple backfilled runs — one catch-up only,
plus the next normal cadence). `anacron` would also catch up but it lacks
per-minute granularity and rarely covers user crontabs.

## Що шукає

1. **Context-essentials drift** — порушення immutable rules у recent commits
   - Грепає `--no-verify`, raw HTML, state writes outside App.jsx, etc.
2. **Recurring `/fix-review` themes** — читає PR-коментарі за останні 15 PR
   - Якщо одна тема повторюється у 3+ PR → кандидат на нове правило
3. **Stale plans** — `.claude/plans/*.md` старші 14 днів
4. **Agent-memory health** — застарілі / дублюючі / суперечливі memory
5. **Skill / agent inventory** — невикористані skills, overlapping responsibilities
6. **Backend contract drift** — чи не відстали `docs/api-contract.md` /
   `docs/streaming.md` від реального Go backend (окремий репозиторій, не
   в CI цього проєкту — зона реального ризику для frontend-only репо)

## Звіти

Зберігаються в `reports/YYYY-W##.md`. Track-аються в git як audit trail.

`reports/.dreaming.log` — журнал запусків (gitignored).

## Workflow читання

Понеділок ранок:
1. `cat .claude/dreaming/reports/$(date +%Y-W%V).md`
2. Для high-confidence drift items — створити issue або одразу fix
3. Для recurring fix-review themes — додати рядок у `context-essentials.md` або обговорити з командою
4. Для stale plans — або підняти, або `git rm`

## Чим відрізняється від /revival

| | /revival | dreaming |
|---|----------|----------|
| Тригер | On-demand | Scheduled (systemd timer) |
| Scope | Health snapshot | Pattern detection across time |
| Вхід | Структура зараз | Recent commits + PR comments |
| Output | Snapshot діагноз | Trend report |

Доповнюють одне одне. /revival — "як я зараз?", dreaming — "що в мене
накопичилось?"

## Cost

~$0.5-1 per pass (Opus, ~30-60K input tokens, ~5-10K output).
Тижневий запуск → ~$2-4/місяць. Щоденний — ~$15-30/місяць (overkill).

## Related

- Backend's own dreaming: `~/wrk/projects/vmm-rada/vmm-rada/.claude/dreaming/`
  (Sunday 04:00 — offset from this one to avoid API-load collision)
- User-level: `~/wrk/common/dreaming/` (cross-project Claude Code memory)
- Wiki: `~/Documents/llm-wiki/wiki/dreaming.md` (загальний concept)
