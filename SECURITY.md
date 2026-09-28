# Security

Please report security problems privately: open the repository's **Security** tab and
choose **Report a vulnerability**. Don't open a public issue for them.

Include what you found, how to reproduce it, and which version or commit you ran.
You'll get a reply within a week.

Needle is meant to run on your own server behind HTTPS. Its server holds the API keys
for Lidarr and slskd and the Spotify client secret, and checks every request against
Navidrome; see [Security](README.md#security) in the README.
