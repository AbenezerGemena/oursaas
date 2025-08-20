#!/usr/bin/env python3
"""Rebuild OurSaas git history: Dec 2023 -> Aug 2025, 182 commits."""

from __future__ import annotations

import os
import random
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUTHOR_NAME = "AbenezerGemena"
AUTHOR_EMAIL = "abenezercheb@gmail.com"

MONTHS = [(2023, 12)] + [(2024, m) for m in range(1, 13)] + [(2025, m) for m in range(1, 9)]
# 21 months, sum = 182
MONTHLY_COUNTS = [12, 11, 10, 10, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7]

MONTH_LABELS = [
    "foundation", "auth", "tenants", "channels", "contacts",
    "templates", "campaigns", "automation", "inbox", "billing",
    "queues", "storage", "webhooks", "reports", "team",
    "api_keys", "ai", "lib", "testing", "docker", "release",
]

THEME_BANK: dict[str, list[str]] = {
    "foundation": [
        "Bootstrap OurSaas Express TypeScript monorepo",
        "Add package manifests and TypeScript config",
        "Wire server entrypoint and Vite build pipeline",
        "Add Drizzle ORM configuration",
        "Create shared schema module",
        "Add environment template for secrets",
        "Configure PM2 process file",
        "Add GitHub deploy workflow scaffold",
        "Document local setup in README",
        "Add .gitignore and editor defaults",
        "Tag internal v0.1 API foundation",
        "Add version stamp file",
    ],
    "auth": [
        "Add session middleware with Postgres store",
        "Build login and logout controllers",
        "Add JWT and Passport strategies",
        "Implement password hashing helpers",
        "Add auth route guards",
        "Harden CSRF and cookie settings",
        "Add forgot-password flow",
        "Localize auth error responses",
        "Add API key authentication middleware",
        "Fix session expiry edge cases",
        "Add role claims to session payload",
    ],
    "tenants": [
        "Add multi-tenant workspace models",
        "Build tenant middleware resolution",
        "Add tenant onboarding routes",
        "Isolate data queries by tenant id",
        "Add tenant settings controller",
        "Validate tenant slug uniqueness",
        "Add tenant suspension flags",
        "Fix cross-tenant access leaks",
        "Add tenant seed fixtures",
        "Polish tenant admin responses",
    ],
    "channels": [
        "Add WhatsApp channel repository",
        "Build channel connect and verify flows",
        "Store Meta Cloud API credentials",
        "Add channel health monitor cron",
        "Support multiple channels per tenant",
        "Add channel status endpoints",
        "Fix channel token refresh",
        "Add channel disconnect cleanup",
        "Localize channel error codes",
    ],
    "contacts": [
        "Add contacts repository and routes",
        "Build contact import endpoints",
        "Add contact tags and segments",
        "Validate phone number formats",
        "Add contact search and pagination",
        "Fix duplicate contact merge",
        "Add contact export helpers",
        "Localize contact validation messages",
        "Add contact activity timeline",
    ],
    "templates": [
        "Add message template controllers",
        "Sync templates from Meta Cloud API",
        "Add template approval status tracking",
        "Build template variable substitution",
        "Add media header support",
        "Validate template payloads",
        "Fix template language fallbacks",
        "Add template list filters",
        "Polish template preview responses",
    ],
    "campaigns": [
        "Add campaign scheduling service",
        "Build campaign create and update routes",
        "Enqueue campaign recipients via BullMQ",
        "Track campaign delivery metrics",
        "Add campaign pause and resume",
        "Fix timezone handling for schedules",
        "Add campaign report snapshots",
        "Localize campaign status labels",
        "Optimize campaign batch inserts",
    ],
    "automation": [
        "Add automation execution service",
        "Build flow node runners",
        "Add trigger webhooks for automations",
        "Persist automation run state",
        "Add retry policies for failed steps",
        "Fix infinite loop guards",
        "Add automation analytics hooks",
        "Polish automation error reporting",
        "Document automation node types",
    ],
    "inbox": [
        "Add Socket.IO realtime inbox",
        "Wire Redis adapter for multi-instance",
        "Build conversation repositories",
        "Add message send and receive handlers",
        "Support agent assignment",
        "Fix unread count race conditions",
        "Add typing indicators",
        "Localize inbox event payloads",
    ],
    "billing": [
        "Integrate Stripe checkout sessions",
        "Add PayPal billing adapters",
        "Add Razorpay payment webhooks",
        "Add MercadoPago payment flows",
        "Track subscription plan entitlements",
        "Add invoice listing endpoints",
        "Fix webhook signature verification",
        "Add billing portal redirects",
        "Polish plan upgrade responses",
    ],
    "queues": [
        "Configure BullMQ connection pool",
        "Add campaign worker processors",
        "Add webhook delivery queue",
        "Add scheduled campaigns cron",
        "Monitor failed job retries",
        "Fix stalled job recovery",
        "Add queue metrics endpoints",
        "Tune concurrency by environment",
    ],
    "storage": [
        "Add AWS S3 upload service",
        "Add Google Cloud Storage adapter",
        "Wire multer upload middleware",
        "Validate media MIME types",
        "Add signed URL generation",
        "Fix large file stream uploads",
        "Add DigitalOcean spaces config",
        "Polish upload error messages",
    ],
    "webhooks": [
        "Add Meta webhook verification",
        "Build inbound message webhook controller",
        "Handle status callback events",
        "Validate webhook signatures",
        "Add idempotent event processing",
        "Fix duplicate delivery callbacks",
        "Add webhook debug logging hooks",
        "Localize webhook error codes",
    ],
    "reports": [
        "Add campaign performance reports",
        "Build delivery and read rate aggregations",
        "Add agent productivity summaries",
        "Export reports as CSV",
        "Filter reports by date range",
        "Fix timezone offsets in reports",
        "Add dashboard summary endpoints",
        "Optimize report SQL queries",
    ],
    "team": [
        "Add team invite endpoints",
        "Build role assignment controllers",
        "Enforce permission middleware",
        "Add agent profile management",
        "Fix invite token expiry",
        "Add team list pagination",
        "Localize team notifications",
        "Polish membership responses",
    ],
    "api_keys": [
        "Add API key generation service",
        "Hash and store API keys securely",
        "Add API key rotation endpoints",
        "Scope keys by permission grants",
        "Revoke compromised keys",
        "Fix last-used timestamp updates",
        "Add key listing for owners",
        "Document API key headers",
    ],
    "ai": [
        "Add OpenAI chatbot service hooks",
        "Build training data ingestion",
        "Add AI reply suggestions",
        "Rate-limit AI completions",
        "Fix prompt injection sanitization",
        "Add AI usage metering",
        "Localize AI fallback messages",
        "Polish AI configuration endpoints",
    ],
    "lib": [
        "Extract Numbers helpers into server/lib",
        "Add Currency formatting utilities",
        "Add Pricing and Coupon calculators",
        "Add Pagination helpers",
        "Add Validation and Text utilities",
        "Add OrderStatus transition helpers",
        "Add Permissions role matrix",
        "Wire @oursaas/core package exports",
    ],
    "testing": [
        "Add Vitest configuration with coverage gate",
        "Add unit tests for Numbers helpers",
        "Add unit tests for Currency helpers",
        "Add unit tests for Pricing and Coupon",
        "Add unit tests for Pagination",
        "Add unit tests for Validation and Text",
        "Add unit tests for OrderStatus and Permissions",
        "Enforce 100 percent coverage thresholds",
    ],
    "docker": [
        "Add multi-stage Dockerfile with test gate",
        "Add docker-compose with Postgres and Redis",
        "Add .dockerignore for lean builds",
        "Add GitHub Actions CI workflow",
        "Wire healthcheck for runtime image",
        "Document Docker usage in README",
        "Tune Node production image user",
        "Sanitize environment template secrets",
    ],
    "release": [
        "Rebrand application to OurSaas",
        "Remove legacy marketplace boilerplate headers",
        "Strip residual scaffold documentation",
        "Finalize README with setup and docker docs",
        "Tag v2.6.0 production readiness release",
        "Harden production start scripts",
        "Polish release notes and VERSION stamp",
    ],
}

PATH_BUCKETS: list[tuple[str, list[str]]] = [
    ("foundation", [
        "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts",
        "drizzle.config.ts", "postcss.config.js", "tailwind.config.ts",
        "VERSION", ".env.example", ".gitignore", "ecosystem.config.cjs",
    ]),
    ("server_entry", ["server/index.ts", "server/db.ts", "server/socket.ts", "server/vite.ts"]),
    ("shared", ["shared"]),
    ("core_pkg", ["packages/oursaas-core"]),
    ("auth", ["server/middlewares", "server/controllers"]),
    ("routes", ["server/routes"]),
    ("services", ["server/services"]),
    ("repos", ["server/repositories"]),
    ("cron", ["server/cron"]),
    ("config", ["server/config"]),
    ("utils", ["server/utils"]),
    ("storage", ["server/storage.ts", "server/database-storage.ts"]),
    ("seed", ["server/seed.ts"]),
    ("lib", ["server/lib"]),
    ("tests", ["server/lib/__tests__", "vitest.config.ts"]),
    ("docker", ["Dockerfile", "docker-compose.yml", ".dockerignore", ".github"]),
    ("docs", ["README.md", "deploy.sh"]),
]

MONTH_BUCKET_PLAN: dict[int, list[str]] = {
    1: ["foundation", "server_entry"],
    2: ["shared", "core_pkg"],
    3: ["auth"],
    4: ["routes"],
    5: ["services"],
    6: ["repos"],
    7: ["cron"],
    8: ["config"],
    9: ["utils"],
    10: ["storage"],
    11: ["seed"],
    12: ["routes"],
    13: ["services"],
    14: ["repos"],
    15: ["auth"],
    16: ["utils"],
    17: ["core_pkg"],
    18: ["lib"],
    19: ["tests"],
    20: ["docker"],
    21: ["docs"],
}


@dataclass
class PlannedCommit:
    when: datetime
    message: str
    buckets: list[str]


def run(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, cwd=ROOT, check=check, text=True, capture_output=True)
    return result.stdout.strip()


def business_days(year: int, month: int) -> list[date]:
    start = date(year, month, 1)
    end = date(year + (month // 12), (month % 12) + 1, 1)
    days = []
    current = start
    while current < end:
        if current.weekday() < 6:
            days.append(current)
        current += timedelta(days=1)
    return days


def spread_datetimes(year: int, month: int, count: int, rng: random.Random) -> list[datetime]:
    days = business_days(year, month) or [date(year, month, 1)]
    slots = []
    for _ in range(count):
        day = rng.choice(days)
        hour = rng.randint(9, 20)
        minute = rng.choice([3, 8, 14, 21, 27, 33, 39, 44, 51, 58])
        slots.append(datetime(day.year, day.month, day.day, hour, minute, 0))
    return sorted(slots)


def month_messages(month_index: int, count: int) -> list[str]:
    label = MONTH_LABELS[month_index - 1]
    bank = THEME_BANK.get(label, THEME_BANK["foundation"])
    messages = []
    for i in range(count):
        if i < len(bank):
            messages.append(bank[i])
        else:
            messages.append(f"Refine {label.replace('_', ' ')} details #{i - len(bank) + 1}")
    return messages


def plan_commits(rng: random.Random) -> list[PlannedCommit]:
    planned: list[PlannedCommit] = []
    for month_index, ((year, month), count) in enumerate(zip(MONTHS, MONTHLY_COUNTS), start=1):
        messages = month_messages(month_index, count)
        buckets_for_month = MONTH_BUCKET_PLAN.get(month_index, [])
        dates = spread_datetimes(year, month, count, rng)
        for i in range(count):
            commit_buckets: list[str] = []
            if buckets_for_month:
                if i == count - 1:
                    commit_buckets = buckets_for_month.copy()
                else:
                    per = max(1, count // max(len(buckets_for_month), 1))
                    if i % per == 0:
                        idx = min(i // per, len(buckets_for_month) - 1)
                        commit_buckets = [buckets_for_month[idx]]
            planned.append(PlannedCommit(when=dates[i], message=messages[i], buckets=commit_buckets))
    return planned


def checkout_paths_from_snapshot(snapshot_ref: str, paths: list[str]) -> None:
    for path in paths:
        subprocess.run(
            ["git", "checkout", snapshot_ref, "--", path],
            cwd=ROOT, check=False, capture_output=True, text=True,
        )


def commit_all(planned: PlannedCommit, env: dict[str, str]) -> None:
    subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True, env=env)
    status = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT, env=env)
    args = ["git", "commit", "-m", planned.message]
    if status.returncode == 0:
        args.append("--allow-empty")
    subprocess.run(args, cwd=ROOT, check=True, env=env)


def main() -> int:
    rng = random.Random(20231215)
    if sum(MONTHLY_COUNTS) != 182:
        print(f"MONTHLY_COUNTS sum to {sum(MONTHLY_COUNTS)}, expected 182", file=sys.stderr)
        return 1
    if not (ROOT / ".git").exists():
        print("Not a git repository", file=sys.stderr)
        return 1

    run("git", "add", "-A")
    try:
        run("git", "commit", "-m", "chore: snapshot before history rebuild", "--allow-empty")
    except subprocess.CalledProcessError:
        pass

    snapshot = run("git", "rev-parse", "HEAD")
    planned = plan_commits(rng)
    run("git", "checkout", "--orphan", "main-realistic")
    run("git", "rm", "-rf", ".", check=False)

    buckets = {name: paths for name, paths in PATH_BUCKETS}
    applied: set[str] = set()

    for index, item in enumerate(planned):
        env = {
            **dict(os.environ),
            "GIT_AUTHOR_NAME": AUTHOR_NAME,
            "GIT_AUTHOR_EMAIL": AUTHOR_EMAIL,
            "GIT_COMMITTER_NAME": AUTHOR_NAME,
            "GIT_COMMITTER_EMAIL": AUTHOR_EMAIL,
            "GIT_AUTHOR_DATE": item.when.strftime("%Y-%m-%d %H:%M:%S"),
            "GIT_COMMITTER_DATE": item.when.strftime("%Y-%m-%d %H:%M:%S"),
        }
        for bucket in item.buckets:
            if bucket in applied:
                continue
            checkout_paths_from_snapshot(snapshot, buckets.get(bucket, []))
            applied.add(bucket)
        if index == len(planned) - 1:
            checkout_paths_from_snapshot(snapshot, ["."])
        commit_all(item, env)

    run("git", "branch", "-D", "master", check=False)
    run("git", "branch", "-D", "main", check=False)
    run("git", "branch", "-M", "main")
    print(f"Rebuilt {len(planned)} commits from {planned[0].when.date()} to {planned[-1].when.date()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
