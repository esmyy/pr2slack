# pr2slack

Send your current GitHub Pull Request to Slack with one command.

## What it does

`pr2slack` uses GitHub CLI (`gh`) to read the current PR and posts it to a Slack Incoming Webhook.

Example Slack message:

`PR #123 Add retry for webhook delivery by alice (feature/retry -> main)`

## Requirements

- Node.js 18+
- GitHub CLI (`gh`) installed and authenticated
  (only required when you do not pass `--url`)
- An open pull request for your current branch
  (only required when you do not pass `--url`)
- A Slack Incoming Webhook URL

## Setup

1. Install globally:

```bash
npm install -g @esmyy/pr2slack
```

2. Create a Slack Incoming Webhook for your channel.
3. Set `SLACK_WEBHOOK_URL` permanently in your shell profile:

```bash
echo 'export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/XXX/YYY/ZZZ"' >> ~/.zshrc
source ~/.zshrc
```

4. Optional: add GitHub-to-Slack user mapping (for real `@` mentions):

```bash
echo 'export SLACK_USER_MAP="{\"alice\":\"U01234567\",\"bob\":\"U07654321\"}"' >> ~/.zshrc
source ~/.zshrc
```

5. Optional: set your most-used reviewers as default:

```bash
echo 'export PR2SLACK_DEFAULT_REVIEWERS="alice,bob"' >> ~/.zshrc
source ~/.zshrc
```

6. Optional: set default team mention:

```bash
echo 'export PR2SLACK_TEAM_MAP="{\"backend\":\"S01234567\",\"mobile\":\"S07654321\"}"' >> ~/.zshrc
echo 'export PR2SLACK_DEFAULT_TEAM="backend"' >> ~/.zshrc
source ~/.zshrc
```

7. Run the tool:

```bash
pr2slack
```

If you are developing from source, you can still run:

```bash
node pr2slack.js
```

## Usage

```bash
pr2slack [options]
```

Options:

- `-w, --webhook <url>`: Slack webhook URL (defaults to `SLACK_WEBHOOK_URL`)
- `-u, --url <url>`: PR URL (skip `gh` lookup)
- `-t, --title <text>`: PR title used with `--url`
- `-m, --message <text>`: Extra note appended after the PR link
- `-r, --reviewers <list>`: Mention selected reviewers
  (comma-separated GitHub logins, for example `alice,bob`)
- `--random [n]`: Pick random reviewers from `SLACK_USER_MAP` keys
- `--random` default count is `2`; example `--random 3`
- `--random` has highest priority and ignores reviewer/team defaults and flags
- `-r` or `--random` enables reviewer mentions
- Default reviewers can come from `PR2SLACK_DEFAULT_REVIEWERS`
- `--team [name|ref]`: Add team mention by team name or raw ref
- If `--team` is passed without a value, it uses `PR2SLACK_DEFAULT_TEAM`
- `--team-map <json>`: JSON map `{"backend":"S01234567","mobile":"S07654321"}`
  (defaults to `PR2SLACK_TEAM_MAP`)
- Default team can come from `PR2SLACK_DEFAULT_TEAM`
- If both `--team` and reviewer options are explicitly provided, both are included
- Precedence: `--random` first; otherwise CLI `-r`/`--team`; if neither is
  provided, use `PR2SLACK_DEFAULT_REVIEWERS`; if empty, use
  `PR2SLACK_DEFAULT_TEAM`
- `--slack-user-map <json>`: JSON map `{"githubLogin":"SLACK_USER_ID"}`
  (defaults to `SLACK_USER_MAP`)
- `--raw-url-only`: Send only PR URL (plus optional message)
- `--dry-run`: Print payload instead of sending
- `-h, --help`: Show help

## Examples

```bash
# Send current PR using SLACK_WEBHOOK_URL
pr2slack

# Add a review note
pr2slack -m "Please review before EOD"

# Mention only two specific reviewers
pr2slack -r alice,bob

# Use default reviewers from PR2SLACK_DEFAULT_REVIEWERS (if configured)
pr2slack

# Pick 2 random reviewers from SLACK_USER_MAP
pr2slack --random

# Pick 3 random reviewers from SLACK_USER_MAP
pr2slack --random 3

# Mention a Slack user group (team)
pr2slack --team backend

# Use default team via flag (no explicit value)
pr2slack --team

# If both are explicitly provided, both team and reviewers are mentioned
pr2slack --team mobile -r alice,bob

# Override team map inline
pr2slack --team backend --team-map '{"backend":"S01234567"}'

# Mention reviewers with inline map override
pr2slack -r alice,bob --slack-user-map '{"alice":"U01234567","bob":"U07654321"}'

# Use a specific webhook explicitly
pr2slack --webhook https://hooks.slack.com/services/XXX/YYY/ZZZ

# Send PR URL directly (no gh required)
pr2slack --url https://github.com/org/repo/pull/123

# Send PR URL with custom title and note
pr2slack --url https://github.com/org/repo/pull/123 --title "Refactor payment retry" -m "Please prioritize"

# Debug payload without sending
pr2slack --dry-run

# Send only PR URL
pr2slack --raw-url-only
```

## Troubleshooting

- `Unable to read current PR`: run `gh auth status`, ensure current branch has an open PR, or use `--url`.
- `Slack webhook is required`: set `SLACK_WEBHOOK_URL` or pass `--webhook`.
- `Slack webhook failed`: verify webhook URL and app/channel permissions.
- Reviewers not pinged: make sure `SLACK_USER_MAP` maps GitHub login to Slack **user ID** (`U...`), not display name.

## License

MIT
