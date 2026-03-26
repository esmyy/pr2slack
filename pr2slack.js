#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const HELP_TEXT = `
pr2slack - Send current GitHub PR URL to Slack

Usage:
  pr2slack [options]

Options:
  -w, --webhook <url>   Slack incoming webhook URL
                        (default: env SLACK_WEBHOOK_URL)
  -u, --url <url>       PR URL (skip gh lookup)
  -t, --title <text>    PR title used with --url
  -m, --message <text>  Extra note appended after PR link
  -r, --reviewers <list>
                        Comma-separated reviewers to mention
                        (example: alice,bob)
                        (default: env PR2SLACK_DEFAULT_REVIEWERS)
  --random [n]          Pick random reviewers from SLACK_USER_MAP keys
                        (default n: 2)
                        (overrides reviewers/team defaults and flags)
  --team [name|ref]     Slack team mention (map key, subteam ID, token, or text)
                        (default: env PR2SLACK_DEFAULT_TEAM)
  --team-map <json>     JSON map: team name -> Slack subteam ID
                        (default: env PR2SLACK_TEAM_MAP)
  --slack-user-map <json>
                        JSON map: GitHub login -> Slack user ID
                        (default: env SLACK_USER_MAP)
  --raw-url-only        Send only the PR URL without title/context
  --dry-run             Print payload instead of sending to Slack
  -h, --help            Show help

Examples:
  pr2slack
  pr2slack -m "Please review this today"
  pr2slack --webhook https://hooks.slack.com/services/XXX/YYY/ZZZ
  pr2slack --url https://github.com/org/repo/pull/123
  pr2slack -r alice,bob
  pr2slack --random
  pr2slack --random 3
  pr2slack --team backend
  pr2slack --raw-url-only
`;

function parseArgs(argv) {
  const defaultReviewers =
    process.env.PR2SLACK_DEFAULT_REVIEWERS ??
    process.env.PR2SLACK_REVIEWERS ??
    "";
  const defaultTeam =
    process.env.PR2SLACK_DEFAULT_TEAM ??
    process.env.PR2SLACK_TEAM ??
    "";

  const args = {
    webhook: process.env.SLACK_WEBHOOK_URL ?? "",
    slackUserMap: process.env.SLACK_USER_MAP ?? "",
    url: "",
    title: "",
    message: "",
    reviewers: "",
    reviewersFromCli: false,
    randomReviewers: false,
    randomCount: 2,
    team: "",
    teamFromCli: false,
    teamMap: process.env.PR2SLACK_TEAM_MAP ?? process.env.SLACK_TEAM_MAP ?? "",
    rawUrlOnly: false,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "-h" || current === "--help") {
      args.help = true;
      continue;
    }
    if (current === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (current === "--raw-url-only") {
      args.rawUrlOnly = true;
      continue;
    }
    if (current === "-r" || current === "--reviewers") {
      if (!next) {
        throw new Error("Missing value for -r/--reviewers");
      }
      args.reviewers = next;
      args.reviewersFromCli = true;
      i += 1;
      continue;
    }
    if (current === "--random") {
      args.randomReviewers = true;
      if (next && !next.startsWith("-")) {
        const parsed = Number.parseInt(next, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error("--random value must be a positive integer");
        }
        args.randomCount = parsed;
        i += 1;
      }
      continue;
    }
    if (current === "--team") {
      // Support "--team" without a value: fallback to default team.
      const hasValue = Boolean(next) && !next.startsWith("-");
      if (hasValue) {
        args.team = next;
        i += 1;
      } else if (defaultTeam) {
        args.team = defaultTeam;
      } else {
        throw new Error(
          "Missing value for --team and PR2SLACK_DEFAULT_TEAM is not set.",
        );
      }
      args.teamFromCli = true;
      continue;
    }
    if (current === "--team-map") {
      if (!next) {
        throw new Error("Missing value for --team-map");
      }
      args.teamMap = next;
      i += 1;
      continue;
    }
    if (current === "-w" || current === "--webhook") {
      if (!next) {
        throw new Error("Missing value for --webhook");
      }
      args.webhook = next;
      i += 1;
      continue;
    }
    if (current === "-u" || current === "--url") {
      if (!next) {
        throw new Error("Missing value for --url");
      }
      args.url = next;
      i += 1;
      continue;
    }
    if (current === "-t" || current === "--title") {
      if (!next) {
        throw new Error("Missing value for --title");
      }
      args.title = next;
      i += 1;
      continue;
    }
    if (current === "-m" || current === "--message") {
      if (!next) {
        throw new Error("Missing value for --message");
      }
      args.message = next;
      i += 1;
      continue;
    }
    if (current === "--slack-user-map") {
      if (!next) {
        throw new Error("Missing value for --slack-user-map");
      }
      args.slackUserMap = next;
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${current}`);
  }

  // --random has highest priority and ignores reviewer/team inputs.
  if (args.randomReviewers) {
    args.reviewers = "";
    args.team = "";
    return args;
  }

  // Precedence:
  // 1) Explicit CLI values (-r / --team)
  // 2) If neither provided: default reviewers, else default team
  if (!args.reviewersFromCli && !args.teamFromCli) {
    if (defaultReviewers) {
      args.reviewers = defaultReviewers;
    } else if (defaultTeam) {
      args.team = defaultTeam;
    }
  }

  return args;
}

function getCurrentPr() {
  try {
    const output = execFileSync(
      "gh",
      [
        "pr",
        "view",
        "--json",
        "url,title,number,author,headRefName,baseRefName,reviewRequests",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return JSON.parse(output);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "failed to run gh command";
    throw new Error(
      `Unable to read current PR. Make sure you are in a repo branch with an open PR and gh is authenticated. (${message})`,
    );
  }
}

function buildMessage(pr, args) {
  const url = args.url || pr.url;
  if (args.rawUrlOnly) {
    return args.message ? `${url}\n${args.message}` : url;
  }

  if (args.url) {
    const label = args.title ? args.title : "Pull Request";
    const link = `<${url}|${label}>`;
    const suffix = args.message ? `\n${args.message}` : "";
    return `PR ${link}${suffix}`;
  }

  const author = pr.author?.login ? ` by ${pr.author.login}` : "";
  const link = `<${url}|#${pr.number} ${pr.title}>`;
  const branch = `(${pr.headRefName} -> ${pr.baseRefName})`;
  const suffix = args.message ? `\n${args.message}` : "";
  return `PR ${link}${author} ${branch}${suffix}`;
}

function parseSlackUserMap(rawMap) {
  if (!rawMap) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawMap);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("map must be a JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Slack user map JSON: ${message}`);
  }
}

function parseTeamMap(rawMap) {
  if (!rawMap) {
    return {};
  }
  try {
    const parsed = JSON.parse(rawMap);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("map must be a JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid team map JSON: ${message}`);
  }
}

function getReviewRequests(pr) {
  const reviewRequests = pr.reviewRequests;
  if (!reviewRequests) {
    return [];
  }

  if (Array.isArray(reviewRequests)) {
    return reviewRequests;
  }
  if (Array.isArray(reviewRequests.nodes)) {
    return reviewRequests.nodes;
  }
  if (Array.isArray(reviewRequests.edges)) {
    return reviewRequests.edges.map((edge) => edge.node).filter(Boolean);
  }
  return [];
}

function toReviewerName(reviewRequest) {
  if (typeof reviewRequest === "string" && reviewRequest.trim()) {
    return reviewRequest.trim();
  }
  if (!reviewRequest || typeof reviewRequest !== "object") {
    return "";
  }

  const directLogin =
    typeof reviewRequest.login === "string" ? reviewRequest.login : "";
  if (directLogin) {
    return directLogin;
  }

  const requestedReviewer =
    typeof reviewRequest.requestedReviewer === "object"
      ? reviewRequest.requestedReviewer
      : null;
  if (requestedReviewer) {
    if (typeof requestedReviewer.login === "string" && requestedReviewer.login) {
      return requestedReviewer.login;
    }
    if (typeof requestedReviewer.name === "string" && requestedReviewer.name) {
      return requestedReviewer.name;
    }
  }

  if (typeof reviewRequest.name === "string" && reviewRequest.name) {
    return reviewRequest.name;
  }

  return "";
}

function parseReviewers(rawValue) {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function pickRandomItems(values, count) {
  if (count <= 0 || values.length === 0) {
    return [];
  }

  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function normalizeSlackTeamMention(rawValue) {
  if (!rawValue) {
    return "";
  }

  if (rawValue.startsWith("<")) {
    return rawValue;
  }

  // Slack user group IDs typically look like S01234567.
  if (/^S[A-Z0-9]+$/i.test(rawValue)) {
    return `<!subteam^${rawValue}>`;
  }

  return rawValue;
}

function resolveTeamRef(rawTeamRef, teamMap) {
  if (!rawTeamRef) {
    return "";
  }
  const trimmedRef = rawTeamRef.trim();
  if (!trimmedRef) {
    return "";
  }

  if (
    typeof teamMap[trimmedRef] === "string" &&
    teamMap[trimmedRef].trim()
  ) {
    return teamMap[trimmedRef].trim();
  }

  const loweredRef = trimmedRef.toLowerCase();
  for (const key of Object.keys(teamMap)) {
    if (key.toLowerCase() === loweredRef) {
      const mapped = teamMap[key];
      if (typeof mapped === "string" && mapped.trim()) {
        return mapped.trim();
      }
      break;
    }
  }

  return trimmedRef;
}

function buildReviewerSuffix(pr, args, slackUserMap, teamMap) {
  const mapReviewerNames = Object.keys(slackUserMap).filter(Boolean);

  if (args.randomReviewers) {
    const randomReviewerNames = pickRandomItems(mapReviewerNames, args.randomCount);
    if (randomReviewerNames.length === 0) {
      return "";
    }
    const mentionTokens = randomReviewerNames.map((name) => {
      const slackId =
        typeof slackUserMap[name] === "string" ? slackUserMap[name] : "";
      return slackId ? `<@${slackId}>` : `@${name}`;
    });
    return `\nReviewers: ${mentionTokens.join(" ")}`;
  }

  const resolvedTeamRef = resolveTeamRef(args.team, teamMap);
  const teamMention = normalizeSlackTeamMention(resolvedTeamRef);

  const shouldIncludeReviewers = Boolean(args.reviewers);
  if (!shouldIncludeReviewers) {
    return teamMention ? `\nTeam: ${teamMention}` : "";
  }

  const selectedReviewers = parseReviewers(args.reviewers);
  let uniqueReviewerNames = [...new Set(selectedReviewers)];

  if (uniqueReviewerNames.length === 0) {
    uniqueReviewerNames = [...new Set(
      getReviewRequests(pr)
        .map(toReviewerName)
        .filter(Boolean),
    )];
  }

  if (uniqueReviewerNames.length > 0) {
    const mentionTokens = uniqueReviewerNames.map((name) => {
      const slackId =
        typeof slackUserMap[name] === "string" ? slackUserMap[name] : "";
      return slackId ? `<@${slackId}>` : `@${name}`;
    });
    const reviewersLine = `Reviewers: ${mentionTokens.join(" ")}`;
    const explicitReviewerIntent = args.reviewersFromCli;
    if (teamMention && args.teamFromCli && explicitReviewerIntent) {
      return `\nTeam: ${teamMention}\n${reviewersLine}`;
    }
    return `\n${reviewersLine}`;
  }

  return teamMention ? `\nTeam: ${teamMention}` : "";
}

async function postToSlack(webhook, text) {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed: ${response.status} ${body}`);
  }
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));

    if (args.help) {
      process.stdout.write(HELP_TEXT.trimStart());
      process.stdout.write("\n");
      return;
    }

    if (!args.dryRun && !args.webhook) {
      throw new Error(
        "Slack webhook is required. Set SLACK_WEBHOOK_URL or pass --webhook.",
      );
    }

    const slackUserMap = parseSlackUserMap(args.slackUserMap);
    const teamMap = parseTeamMap(args.teamMap);
    const pr = args.url ? { url: args.url } : getCurrentPr();
    const baseText = buildMessage(pr, args);
    const reviewerSuffix = buildReviewerSuffix(pr, args, slackUserMap, teamMap);
    const text = `${baseText}${reviewerSuffix}`;

    if (args.dryRun) {
      process.stdout.write(JSON.stringify({ text }, null, 2));
      process.stdout.write("\n");
      return;
    }

    await postToSlack(args.webhook, text);
    process.stdout.write(`Sent to Slack: ${pr.url}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`pr2slack error: ${message}\n`);
    process.exitCode = 1;
  }
}

main();
