# Security

Please report security problems privately: open the repository's **Security** tab and
choose [**Report a vulnerability**](https://github.com/bugrauluyurt/needle/security/advisories/new).
Don't open a public issue for them.

Include what you found, how to reproduce it, and which version or commit you ran.
You'll get a reply within 7 days. Once a fix is released, the advisory is published with
credit to you, unless you'd rather stay unnamed; please keep the vulnerability private
until then.

Each release since v1.5.0 carries its source archive with signed build provenance, and
each image has provenance on GHCR; the README's
[Data, backups and updates](README.md#data-backups-and-updates) shows how to check them.

Needle is meant to run on your own server behind HTTPS. Its server holds the API keys
for Lidarr and slskd and the Spotify client secret, and checks every request against
Navidrome; see [Security](README.md#security) in the README.
