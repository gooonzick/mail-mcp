# mail-mcp

[Русская версия](README.ru.md)

A stdio [MCP](https://modelcontextprotocol.io) server for your own mailboxes over IMAP/SMTP. Claude, or any other MCP client, can list folders, search and read mail, and prepare drafts and replies. Mail goes out only through `send_draft`, from a draft you have seen and approved.

- Several accounts; each one sends only through its own SMTP server and only as its own address.
- Passwords live in the macOS Keychain or in environment variables, never in the config or in tool output.
- Drafts are written in Markdown: `[words](https://url)` becomes a link on those words, and a plain-text alternative is generated.
- Sent, Drafts and Trash are found by IMAP SPECIAL-USE flags, with localized folder names as a fallback.
- Everything taken from an email reaches the model inside nonce-tagged `<untrusted-email-content>` markers.

Tested with Gmail and reg.ru shared hosting (ISPmanager).

## Requirements

- Node.js 20.19 or later.
- macOS Keychain for passwords, or environment variables on any OS.

## Setup

### 1. Store the passwords

Gmail needs an app password: turn on 2-Step Verification, then create one at <https://myaccount.google.com/apppasswords> and enter the 16 letters without spaces. Other providers usually take the mailbox password.

```bash
security add-generic-password -U -s mail-mcp -a you@gmail.com -w
```

`security` asks for the password twice without echoing it, so it stays out of your shell history; `-U` updates an existing item. To check that the item exists without printing the password:

```bash
security find-generic-password -s mail-mcp -a you@gmail.com
```

Without the Keychain, point the account at an environment variable: `"password": { "env": "MAIL_MCP_WORK_PASSWORD" }`.

### 2. Describe the mailboxes

Create `~/.config/mail-mcp/accounts.json`, or set `MAIL_MCP_CONFIG` to another path, starting from [accounts.example.json](accounts.example.json). The file is read on every call, so edits apply without a restart.

| Field | Meaning |
| --- | --- |
| `id` | short account name the tools take, such as `gmail` or `work` |
| `email` | the address; the account sends only as this address |
| `displayName` | sender name in `From` |
| `login` | IMAP/SMTP login when it differs from the address (optional) |
| `imap`, `smtp` | `host`, `port`, `secure`: `true` for implicit TLS (993/465), `false` for a connection that must upgrade with STARTTLS |
| `smtpSavesToSent` | whether the SMTP server files a copy in Sent by itself |
| `password` | `{ "keychain": { "service": "mail-mcp", "account": "<address>" } }` or `{ "env": "VARIABLE" }` |

| Provider | IMAP | SMTP | `smtpSavesToSent` |
| --- | --- | --- | --- |
| Gmail | `imap.gmail.com:993`, TLS | `smtp.gmail.com:465`, TLS | `true` |
| reg.ru shared hosting | `mail.hosting.reg.ru:993`, TLS | `mail.hosting.reg.ru:465`, TLS | `false` |

With `smtpSavesToSent: false` the server appends each sent message to Sent over IMAP. Most hosting SMTP servers keep no copy; if Sent shows duplicates after the first send, set it to `true`.

### 3. Connect a client

Claude Code:

```bash
claude mcp add --scope user mail -- npx -y @gooonzick/mail-mcp
```

Other MCP clients, such as Claude Desktop or Cursor:

```json
{
  "mcpServers": {
    "mail": { "command": "npx", "args": ["-y", "@gooonzick/mail-mcp"] }
  }
}
```

GUI apps may start without your shell's `PATH`; if the client cannot find `npx`, use the absolute path from `which npx`.

## Tools

| Tool | What it does |
| --- | --- |
| `list_accounts` | accounts from the config and whether each password is available (never the password itself) |
| `list_folders` | folders with their role (inbox, sent, drafts, trash, junk, archive, all, flagged) and message counts |
| `search_messages` | search a folder by sender, recipient, subject, date and unread state; newest first |
| `get_message` | headers, the text part (or the HTML converted to text) and the attachment list; does not mark the message as read |
| `create_draft` | saves a new message to Drafts: to, cc, bcc, subject and a Markdown body |
| `reply` | saves a reply as a draft: `In-Reply-To`/`References`, "Re:" subject, quoted original, optional reply-all |
| `send_draft` | **the only tool that sends** |
| `mark` | read/unread, flagged/unflagged |
| `move` | moves messages to another folder |

A folder argument takes a role (`inbox`, `sent`, `drafts`, `trash`, `junk`, `archive`, `all`, `flagged`) or an exact path from `list_folders`. UIDs are per folder: a message is identified by account, folder and UID.

## How sending works

1. `create_draft` or `reply` builds the MIME message (HTML and text as `multipart/alternative`) and appends it to Drafts with the `\Draft \Seen` flags.
2. The client shows you the draft: recipients, subject and text. It should call `send_draft` only after you confirm.
3. `send_draft`:
   - refuses a draft whose `From` is not the account's address;
   - removes the `Bcc` header and sets a fresh `Message-ID` and `Date` (Bcc recipients stay in the SMTP envelope);
   - sends through the account's own SMTP server;
   - with `smtpSavesToSent: false`, appends the exact sent bytes to Sent (`\Sent`) with `\Seen`; Gmail files its own copy, so nothing is appended there;
   - moves the draft to Trash.
4. If the SMTP server rejects the message, nothing is appended to Sent and the draft stays where it was.

## Security

- Email content (senders, subjects, bodies, attachment names) comes back inside `<untrusted-email-content nonce="…">` with a note that it is data, not instructions. The nonce changes on every call, and invisible Unicode characters (tag characters, bidi overrides) are removed.
- Reading never changes the mailbox: folders are opened read-only (EXAMINE) and messages are fetched with `BODY.PEEK`.
- `send_draft` is marked with `destructiveHint` and `openWorldHint`; no other tool reaches outside your mailboxes. Claude Code asks before each MCP tool call by default, so keep `mcp__mail__send_draft` out of your allow list.
- Error messages are scrubbed of passwords as a last line of defence.

## Development

```bash
git clone https://github.com/gooonzick/mail-mcp.git
cd mail-mcp
pnpm install
```

From a checkout, Node.js 24 runs the TypeScript sources directly through type stripping: `node src/index.ts`.

| Command | What it does |
| --- | --- |
| `pnpm test` | unit tests plus a stdio test of the whole server; IMAP and SMTP are faked, nothing touches the network |
| `pnpm typecheck` | TypeScript check |
| `pnpm smoke` | read-only check of your configured accounts: folders, newest inbox and sent messages |
| `pnpm smoke <tool> '<json>'` | calls one tool and prints the result |
| `pnpm build` | compiles to `dist/`; runs by itself before `npm pack` and `npm publish` |

### Releasing

```bash
npm version patch        # or minor / major: bumps package.json, commits and tags vX.Y.Z
git push --follow-tags
```

The tag starts the [release workflow](.github/workflows/release.yml). It checks that the tag matches the version in `package.json`, runs the typecheck and tests, builds, publishes to npm and creates a GitHub release. Publishing goes through npm [trusted publishing](https://docs.npmjs.com/trusted-publishers): the repository holds no npm token, and the package gets a provenance attestation that links it to the commit and workflow it was built from. The trusted publisher is configured once in the package settings on npmjs.com: GitHub Actions, repository `gooonzick/mail-mcp`, workflow `release.yml`.

## License

[MIT](LICENSE)
