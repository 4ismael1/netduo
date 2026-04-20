---
layout: default
title: NetDuo Privacy Policy
permalink: /privacy/
---

# NetDuo Privacy Policy

**Last updated:** April 2026
**Applies to:** NetDuo desktop application (Windows), all versions.

NetDuo is a local network diagnostics and monitoring tool. This policy explains exactly what data the app processes, where it goes, and what we do — and do not — collect about you.

**Short version: we do not collect, store, or transmit any personal data to our own servers. We do not have servers.** Everything happens on your device. The only outbound traffic is to public internet services that *you* use (speed-test servers, DNS resolvers, domains you type into the tools, etc.).

---

## 1. Data we collect

**None.** NetDuo has no backend. We do not run analytics, telemetry, crash reporting, or user tracking. We never see your IP, your MAC address, your network devices, your test history, or any other information from your computer.

---

## 2. Data stored **locally on your device**

To provide its features, NetDuo stores the following information in a local SQLite database in your Windows user-data directory (typically `%APPDATA%\netduo\`):

| What | Why | Retention |
|---|---|---|
| Test history (ping, traceroute, DNS, port scan, SSL, WHOIS results) | So you can review past runs | Last 500 entries, auto-purged |
| Speed-test history (download/upload/latency/jitter/server) | So you can compare performance over time | Last 100 entries, auto-purged |
| LAN security scan reports | So you can re-open past reports | Last 120 entries, auto-purged |
| App settings (theme, poll interval, notification prefs) | So your preferences persist | Until you change them |
| WAN Probe credentials (if you configure any) | So you don't retype them each session | Encrypted at rest via Electron's `safeStorage` |

This data never leaves your device. Uninstalling NetDuo removes it.

A small startup log (`netduo-startup.log`) is also written to the user-data directory for local debugging of launch errors. It contains no personal data.

---

## 3. Automatic outbound requests

When NetDuo is running, it periodically makes the following external requests **by default**, to populate the dashboard:

| Service | Host | What is sent | What is received |
|---|---|---|---|
| Public IP lookup | `api.ipify.org` | Standard HTTPS GET (no payload) | Your public IP address |
| IP geolocation | `ip-api.com` | Your public IP as a URL path parameter | Country, city, ISP, organization, approximate latitude/longitude, timezone, ASN |
| MAC vendor lookup | `api.macvendors.com` | MAC address prefix (OUI) of devices found on your local network, while a LAN scan runs | Vendor name |

These are standard, stateless HTTP requests. We send no identifiers, no cookies, no headers beyond a `User-Agent: NetDuo/1.x`. These services are operated by independent third parties and are governed by their own privacy policies.

If you do not want NetDuo to make these calls, do not open the Dashboard or LAN Scanner, or block outbound traffic to those hosts in your firewall.

---

## 4. User-triggered outbound requests

Most network features only contact external services **when you explicitly use them**. In every case, the destination is either a well-known public service, or a host you typed yourself.

| Feature | Contacts | Triggered by |
|---|---|---|
| Speed Test | `locate.measurementlab.net` + M-Lab NDT7 server, `speed.cloudflare.com`, `speed.hetzner.de`, `proof.ovh.net` (whichever server you pick) | Clicking **Start Test** |
| DNS Benchmark | Cloudflare `1.1.1.1`, Google `8.8.8.8`, Quad9 `9.9.9.9`, OpenDNS `208.67.222.222` | Clicking **Run Benchmark** |
| DNS Resolution | Your configured DNS servers | Entering a domain in the Diagnostics tab |
| Traceroute / Ping / MTR / Port Checker / Port Scanner | The host or IP you enter | Clicking Start |
| SSL Inspector | The host you enter (TLS handshake only, no HTTP request body) | Clicking Check SSL |
| HTTP Tester | The URL you enter (with headers/method you specify) | Clicking Send |
| WHOIS | `whois.iana.org` + referral WHOIS servers | Clicking Look Up |
| WAN Probe | Only the probe endpoints **you** configure in Settings | Clicking Run Scan |
| LAN Scanner, LAN Check | Only hosts on **your own local subnet** (plus the MAC-vendor lookup noted above) | Clicking Scan |

The content of these requests is standard network-protocol traffic (ICMP echo, TCP SYN, DNS query, HTTPS GET, WebSocket frames). We send no user identifiers beyond what the protocol itself requires (e.g., your public IP is visible to any server you contact — this is how the internet works).

---

## 5. What we do **not** do

- We do not run analytics or telemetry of any kind.
- We do not use Sentry, Mixpanel, Segment, Google Analytics, Firebase, or any similar third-party SDK.
- We do not auto-update. The app never phones home to check versions.
- We do not collect crash reports.
- We do not read files outside NetDuo's own data directory.
- We do not access your camera, microphone, location, Bluetooth, or contacts.
- We do not embed advertising.
- We do not sell, trade, or share any data (because we have none to share).

---

## 6. System information accessed locally

To display network context, NetDuo reads the following from your operating system, all **read-only** and all **on-device**:

- Network interfaces (IPs, MACs, subnet, gateway)
- DNS server configuration
- Connected Wi-Fi SSID and signal strength (Windows only)
- ARP table (local MAC/IP mapping)
- Basic system info (CPU count, total RAM, OS version)

None of this is transmitted anywhere.

---

## 7. Children

NetDuo is a general-audience utility and is not directed at children under 13. We do not knowingly collect information from anyone.

---

## 8. Changes to this policy

If this policy ever changes in a material way, the updated version will be published at the same URL and the "Last updated" date above will be revised. Because the app is open source, all changes are also visible in the project's git history.

---

## 9. Contact

Questions, concerns, or corrections? Open an issue at:

**[github.com/4ismael1/netduo/issues](https://github.com/4ismael1/netduo/issues)**

Source code: **[github.com/4ismael1/netduo](https://github.com/4ismael1/netduo)**
