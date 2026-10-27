# Paybox local state

Local in-app Paybox credentials now use `~/.config/dock/private/paybox.json`, outside the application tree, with directory mode 0700 and file mode 0600. Writes are atomic and symlink/hardlink files are refused. This is local permission protection, not encryption and not protection from the same OS user or a compromised host.

Old `data/paybox.json` state is deliberately not read or copied. Local installations that used that file must reconnect once. If that file was committed or shared, revoke the affected connection through Paybox before reconnecting, then remove the old local file. Do not paste credentials into reports or tests. Changing the path does not revoke previously exposed credentials.

Existing KV, environment-based and Paybox SDK-managed connections keep their current backend. KV failure now fails closed instead of writing credentials to another backend. On Vercel without KV the in-app connection remains memory-only and does not import packaged files.
