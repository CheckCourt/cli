# Changelog

## 0.1.0

First public release.

- App development commands for your developer organisation's sandbox club:
  - `login` / `logout` with the OAuth 2.0 Device Authorization Grant; the token is stored
    in `~/.checkcourt.json` or taken from `CHECKCOURT_CLI_TOKEN`.
  - `listen --app <slug> --forward-to <url>` forwards webhook deliveries and declarative
    extension requests to your local app, with unchanged headers and body so signatures
    verify, and reconnects with exponential backoff.
  - `trigger <event> --app <slug>` and `trigger --list` create test events.
  - `logs --app <slug> [--follow]` shows recent deliveries.
- API commands with a personal API key: `tenants`, `slots`, `bookings`, `book`, `cancel`,
  plus an interactive terminal app when run without arguments.
- Defaults to `https://app.checkcourt.de`; `CHECKCOURT_HOST`, `--host` and
  `CHECKCOURT_BASE_URL` point it elsewhere.
