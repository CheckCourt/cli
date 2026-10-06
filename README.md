# CheckCourt CLI

`checkcourt` is the command line tool for [CheckCourt](https://checkcourt.de). It does two
things:

- **App development:** connect the app running on your machine to your developer
  organisation's sandbox club. `listen` forwards webhook deliveries and extension requests
  to `localhost`, `trigger` creates test events, `logs` shows deliveries. No public URL or
  tunnel needed.
- **API from the terminal:** an interactive terminal app and a few scriptable commands to
  list your clubs, browse free slots, book and cancel, using a personal API key.

The CLI is built on the [CheckCourt TypeScript SDK](https://github.com/CheckCourt/sdk). Its
output is in German, like the rest of CheckCourt.

## Install

Requires Node.js 20 or later.

```bash
npm install -g github:CheckCourt/cli
checkcourt help
```

npm builds the CLI on install. A release on npm as `@checkcourt/cli` is planned.

## App development

You need to be a member of a developer organisation with a sandbox club, and your app needs
to be installed there. See the [developer documentation](https://docs.checkcourt.de/docs/developer/cli)
for the full guide.

```bash
checkcourt login                                               # confirm the code in your browser
checkcourt listen --app my-app --forward-to http://localhost:4000
checkcourt trigger booking.created --app my-app
checkcourt trigger --list
checkcourt logs --app my-app --follow
checkcourt logout
```

### `login`

Uses the OAuth 2.0 Device Authorization Grant (RFC 8628): the CLI prints a code and opens
the confirmation page in your browser. Check that the codes match and confirm. Use
`--no-browser` on machines without a browser and open the printed URL elsewhere.

### `listen`

```bash
checkcourt listen --app my-app --forward-to http://localhost:4000
```

| Option | Meaning |
|---|---|
| `--app` | Slug or id of your app |
| `--forward-to` | Origin of your local app |
| `--webhook-path` | Path for webhooks. Default: the path of the app's webhook URL |
| `--extension-path` | Path for all extension requests. Default: the path of each extension URL in the manifest |

Requests arrive with exactly the headers and body production would send, including
`CheckCourt-Signature`, so your signature verification works unchanged. Each request prints
one line with time, kind, event or extension point, your app's status and the duration.
Press Ctrl+C to stop. Dropped connections are re-established with exponential backoff.

Only your organisation's sandbox club is ever relayed. Deliveries to real clubs always go to
your production URLs.

### `trigger`

```bash
checkcourt trigger booking.created --app my-app
checkcourt trigger --list
```

Makes a real change in your sandbox club (for example a booking by a test member), so the
event is produced and delivered like any other.

### `logs`

```bash
checkcourt logs --app my-app [--follow]
```

Shows recent webhook deliveries to your app's sandbox installations. `--follow` keeps
polling.

## API commands

These use a personal API key (`ck_user_…`). Personal keys have to be enabled for your club;
ask [CheckCourt support](mailto:support@checkcourt.de) if they are not. Create a key in the
CheckCourt app under your settings.

```bash
export CHECKCOURT_API_KEY="ck_user_..."
checkcourt tenants                       # your clubs and their ids
export CHECKCOURT_TENANT_ID="<club id>"

checkcourt slots --date 2026-10-14 --duration 60
checkcourt bookings
checkcourt book --court 1 --date 2026-10-14 --start 10:00 --end 11:00 --guest "Max"
checkcourt cancel <booking id>
```

Run `checkcourt` without arguments to start the interactive terminal app: it asks for your
key once, then lets you pick a club, browse free slots, book and cancel.

Depending on the club's booking rules, a booking may need a partner or guest; `--guest NAME`
adds a guest (guest fees may apply).

## Configuration

| Variable | Meaning |
|---|---|
| `CHECKCOURT_HOST` | Platform origin for `login`, `listen`, `trigger`, `logs`. Default `https://app.checkcourt.de`. Also `--host` |
| `CHECKCOURT_CLI_TOKEN` | Developer token for CI instead of `checkcourt login` |
| `CHECKCOURT_API_KEY` | Personal API key for the API commands |
| `CHECKCOURT_TENANT_ID` | Club id for club-scoped API commands |
| `CHECKCOURT_BASE_URL` | API base URL. Default `https://app.checkcourt.de/api/v1` |

Environment variables override the config file `~/.checkcourt.json`. For a self-hosted or
local platform, set `CHECKCOURT_HOST` (and `CHECKCOURT_BASE_URL` for the API commands).

## Security

- `checkcourt login` stores a developer token (`ccd_…`) in `~/.checkcourt.json`, written
  with file mode `0600`. The token is valid for 30 days.
- It only works for the developer commands and only for organisations you belong to. It
  cannot call the REST API.
- Your logins are listed in the developer portal under your organisation, where you can end
  any of them. `checkcourt logout` ends the current one and removes it from the file.
- A personal API key you enter in the interactive app is stored in the same file.

Please do not report security issues in public GitHub issues. Report them privately to
CheckCourt support at [support@checkcourt.de](mailto:support@checkcourt.de).

## Contributing

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/index.js help
```

`npm run dev -- <command>` runs the CLI from source without a build.

## License

[MIT](LICENSE)
