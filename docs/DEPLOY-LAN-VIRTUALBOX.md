# Deploy to a VirtualBox VM on your LAN (Windows host, Ubuntu guest, k3s)

> **TL;DR available:** once the VM from steps 3–5 exists and
> `ansible/inventory.ini` lists it, `./start lan` does everything below
> (Ansible bootstrap + ArgoCD deploy + smoke tests) in one command — see
> [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md) for the flow and
> [gitops/README.md](../gitops/README.md) for what it sets up.
> This guide remains the full manual walkthrough and the VM-provisioning
> reference (steps 1–5 are still manual; only steps 7–12 are automated).
>
> **Read chapter 2 before installing anything.** It is the network pre-flight:
> four connectivity checkpoints (MacBook → Windows host → Ubuntu VM → cluster
> ports) that prove each hop is actually reachable, with a fix for every way a
> hop can fail. Installing the VM before checkpoint 1 passes is how you end up
> debugging k3s for an hour when the real problem was router isolation.
>
> **No router access (or don't want to touch it)? Also fine — §2.7 is the
> chapter for you.** In the common case the router needs zero changes for the
> whole setup; and even if the Wi-Fi refuses to carry Mac↔PC traffic at all,
> §2.7 gives a direct-cable bypass and a NAT+port-forward variant, both of
> which end in the exact same `./start lan`.

Run the exact same stack — same chart, same `secrets.yaml`, same `grogu.test` /
`auth.test` domains, same Docker Hub images — on a Linux VM that lives on your
Windows machine, and drive it from your MacBook over Wi-Fi. Nothing in the repo
changes. This is the dress rehearsal for a real VPS: on a VPS you repeat
**steps 7–12** and swap the `*.test` hostnames for real DNS names.

```
MacBook (browser, kubectl, helm)          Windows PC
        │  http://grogu.test                     │  VirtualBox
        │  hosts file → VM_IP                    │  ┌────────────────────┐
        ▼                                        │  │ Ubuntu 24.04 VM    │
   ┌───────── VM_IP ─────────┐  Wi-Fi  ────────►│  │  k3s (single node) │
   │ :80/:443 ServiceLB      │                  │  │  :6443 k8s API     │
   │  └─ ingress-nginx       │                  │  └────────────────────┘
   │     ├ grogu.test  → react-front :9071, gateway :8787 (/api/…)
   │     ├ auth.test   → keycloak :8080
   │     ├ prom.test / grafana.test (only if metrics enabled)
   │     ├ postgres (hostPath /data/postgresql)
   │     └ redis, nodejs-back, golang-back
```

What replaces what, compared to `./start` on the MacBook:

| Local Minikube (today)                 | LAN VirtualBox VM (this guide)                          |
|----------------------------------------|---------------------------------------------------------|
| `minikube start --driver=docker`       | k3s installed directly in the Ubuntu VM                 |
| `minikube tunnel` (binds 127.0.0.1:80) | k3s **ServiceLB** binds `:80/:443` on the VM's real IP  |
| `/etc/hosts` → `127.0.0.1`             | hosts files → the **VM's LAN IP**                       |
| `./start` does everything              | you run ~10 commands by hand (steps 7–12)               |
| Calico CNI                             | k3s built-in CNI (also enforces NetworkPolicies)        |

> **Do not run `./start` or `make upgrade` while targeting the VM.** They are
> hardwired to local Minikube: they would start a second cluster and rewrite
> your `/etc/hosts` to `127.0.0.1`.

Time budget for a first run: ~1.5–2.5 h (most of it is Windows prep + the
Ubuntu installer). Every command in steps 6–12 runs on the **MacBook** unless
the step header says otherwise.

Throughout the guide set these once in your MacBook terminal and all later
commands just work (use **your** values):

```bash
VM_IP=192.168.1.50     # the VM's LAN IP — pinned in step 5
VM_USER=maxim          # the user you create inside Ubuntu
```

---

## 1. Prerequisites and sizing

**Network**

- MacBook and Windows PC on the **same Wi-Fi network** (same SSID — beware
  "guest" networks, which isolate clients from each other).
- Router admin access is **optional**: §5 Option B pins the VM's IP without
  it, and §2.7 has a bypass even for a client-isolating Wi-Fi. Have it if you
  can (it makes §5 Option A and some troubleshooting quicker), don't sweat it
  if you can't.

**Windows PC (the VM host)**

| Resource   | Minimum            | Comfortable            |
|------------|--------------------|------------------------|
| RAM        | 16 GB (VM gets 10) | 16 GB                  |
| Free disk  | 60 GB              | 80 GB                  |
| CPU        | 4 cores            | 6+ cores (VM gets 4)   |

An 8 GB Windows machine *can* host a 6 GB VM with the metrics stack off — it
will swap under load; treat it as a smoke test, not a home lab.

**Sizing rule for the VM:** the chart's pods request ~5 Gi total (per
`AGENTS.md`), k3s itself needs ~1 Gi. Give the VM **4 vCPU / 10 GB RAM / 60 GB
disk** if the host has 16 GB; **6–8 GB RAM** otherwise, with metrics **off**
(`kube-prometheus-stack` adds another ~1.5–2 Gi of requests — leave it off on
a small VM).

**MacBook (the cockpit)** — you already have everything if `./start` works
there. Quick check:

```bash
kubectl version --client   # if missing: brew install kubectl
helm version
helm plugin list | grep secrets   # helm-secrets plugin (v4.6.x)
sops --version
gpg --version
```

The stack itself ships as images on Docker Hub (`mmko67/*`), so the VM never
builds anything and neither does the MacBook.

---

## 2. Pre-flight: prove the MacBook can reach the Windows host — and later the VM

Do **not** install anything until the checks in this chapter pass. Every
failure later in this guide (ssh, kubectl, curl, the whole deploy) is either a
network problem or a cluster problem — these checks remove "network" from the
list of suspects before you spend an hour on the install. Run them in order;
each one builds on the previous:

```
checkpoint 1   MacBook ────────► Windows PC            (§2.2 — run NOW, before installing)
checkpoint 2   MacBook ────────► Ubuntu VM             (§2.4 — after §4/§5: VM created, IP pinned)
checkpoint 3   MacBook ── port 22 ──► Ubuntu VM        (§2.5 — ssh works)
checkpoint 4   MacBook ── ports 6443/80/443 ──► VM     (§2.6 — after §7/§9: k3s + ingress)
```

### 2.1 Stage 0 — collect the facts from both machines

**On Windows** (PowerShell — Start → type `powershell` → Enter):

```powershell
ipconfig /all
```

Read three things from the **"Wireless LAN adapter Wi-Fi"** block (ignore
"Ethernet", "vEthernet", "Bluetooth", "Loopback" blocks — those are not the
Wi-Fi):

| Line | Example value | Write it down as |
|---|---|---|
| `IPv4 Address` | `192.168.1.23` | the **Windows PC IP** |
| `Default Gateway` | `192.168.1.1` | the **router IP** (you'll need it in §5) |
| `DHCP Server` | `192.168.1.1` | sanity: same box as the gateway, normally |

Also note what Windows calls this network: **Settings → Network & internet →
Wi-Fi → (your network) → Network profile type** — `Private` or `Public`
(Public is what makes Windows Firewall aggressive; we deal with it below).

**On the MacBook** (Terminal):

```bash
ipconfig getifaddr en0       # the Mac's Wi-Fi IP (try en1 if empty)
route -n get default | awk '/gateway/ {print $2}'   # the router IP
```

**What must be true now:**

- Both IPs are in the **same subnet** — same first three number groups, e.g.
  Mac `192.168.1.15` + PC `192.168.1.23` ✔ (a `/24` home network).
- Mac `192.168.1.15` + PC `192.168.137.1` ✘ — `192.168.137.x` is Windows
  *Mobile Hotspot / Internet Sharing*; the PC is running its own network, not
  joined to yours. Turn the hotspot off and reconnect to the router's Wi-Fi.
- Mac `192.168.1.15` + PC `10.0.0.5` ✘ — the machines are on different
  networks/routers (one of them is on a guest SSID, a mesh node's isolated
  backhaul, or a neighbour's network — recheck which Wi-Fi name each uses).
- **Disconnect any VPN on the Mac** before continuing: a VPN hijacks the
  routing table, and your pings travel into the tunnel instead of the Wi-Fi.
  (`ping` then fails or answers from inside the VPN — both are false signals.)

### 2.2 Checkpoint 1 — MacBook → Windows PC (run this NOW)

```bash
ping -c 3 192.168.1.23       # the Windows IP from stage 0
```

A **ping failure does not tell you *what* is wrong** — there are two very
different blockers, and you need to know which one you have:

1. **Router AP/client isolation** — the router forbids wireless clients from
   talking to each other. Nothing on the Windows side can fix this.
2. **Windows Firewall dropping ICMP** ("ping") — the *default* on networks
   marked **Public**, and very common on laptops. This one is purely a Windows
   setting, and it does **not** mean the machines can't talk on real ports.

So don't debug ping — test an actual **TCP port**. Windows 10/11 ships an
optional OpenSSH **server**; switching it on gives us (a) a port that is
guaranteed to be allowed through the firewall by its own auto-created rule,
and (b) a convenient way to copy files to/from Windows later. On Windows,
**Admin** PowerShell:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0   # installs sshd
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Get-NetFirewallRule -Name *ssh*          # expect "OpenSSH-Server-In-TCP", Enabled: True
```

Now from the **MacBook**:

```bash
nc -vz -w 3 192.168.1.23 22
# success looks like:
#   Connection to 192.168.1.23 port 22 [tcp/ssh] succeeded!
```

(`nc` = netcat, ships with macOS; `-vz` = verbose + "just scan, don't send
data"; `-w 3` = give up after 3 seconds. You will use this one-liner all over
this guide — it is the fastest "is that port open over there" check there is.)

Read the two results together:

| `ping` | `nc :22` | Meaning | Action |
|---|---|---|---|
| ✔ | ✔ | Network is clean end-to-end | Continue to §3. **The router needs zero changes — ever** (see §2.7, case 1). |
| ✘ | ✔ | Windows blocks ICMP, ports work fine | Harmless for this guide. Optionally allow ping (below) for future debugging. Continue. |
| ✘ | ✘ | **AP/client isolation** or different networks | If you *can* log into the router (usually `http://192.168.1.1`): disable *AP Isolation / Client Isolation / Wireless Isolation / Network Segmentation*, move both machines off any *guest* SSID. **If you can't or won't touch the router:** the Wi-Fi can never carry Mac↔PC traffic — skip to §2.7 and use the **direct-cable bypass**, which needs no router at all. |
| ✔ | ✘ | sshd not running or firewalled on Windows | `Get-Service sshd` → `Start-Service sshd`; check the `OpenSSH-Server-In-TCP` firewall rule exists and is enabled; make sure no third-party antivirus firewall took over. |

Optional — make ping work too (Admin PowerShell), so future debugging isn't
confused by the ICMP-block:

```powershell
New-NetFirewallRule -DisplayName "ICMPv4 Echo Request (LAN)" `
  -Protocol ICMPv4 -IcmpType 8 -Direction Inbound -Action Allow -Profile Any
# and/or mark the Wi-Fi as a Private network (less aggressive firewall):
# Settings → Network & internet → Wi-Fi → (your network) → Network profile type → Private
```

**Optional SSH login test** (proves auth, not just the port): `ssh <windows-user>@192.168.1.23`
— your Windows login name is what `whoami` prints after the backslash
(`DESKTOP-ABC\maxim` → user `maxim`). You'll land in `cmd.exe`; type `exit`.

### 2.3 What checkpoint 1 proves — and what it can't

- ✔ proves: the Wi-Fi carries traffic between your two machines, isolation is
  off, subnets match, VPN is out of the way.
- ✘ proves nothing about the **VM** yet — VirtualBox bridging is its own layer
  (checkpoint 2, after §4–§5). But once checkpoint 1 is green, any later
  failure is *provably* not "the Wi-Fi" — it's the VM/bridging/cluster layer,
  which narrows debugging enormously.

### 2.4 Checkpoint 2 — MacBook → Ubuntu VM (after §4 and §5)

Once Ubuntu is installed and the VM has its pinned IP, on the **VM console**
(or the VirtualBox window) run `ip -br a` and note the VM's IP (e.g.
`192.168.1.50` on NIC `enp0s3`). Then from the **MacBook**:

```bash
ping -c 3 192.168.1.50          # VM answers ICMP?
nc -vz -w 3 192.168.1.50 22     # VM answers on the ssh port?
```

**Reverse direction (diagnostics only):** from the VM console,
`ping -c 3 192.168.1.15` (the Mac's IP). If VM→Mac fails while Mac→VM works,
the cause is the macOS firewall's *stealth mode* (System Settings → Network →
Firewall → Options) — it makes the Mac silently drop incoming pings. It does
**not** affect this setup at all, because the Mac only ever *initiates*
connections (ssh, kubectl, curl); ignore it.

| Result | Meaning | Fix |
|---|---|---|
| both ✔ | Bridging works, the VM is a first-class LAN citizen | Continue to §6. |
| ping VM ✘ but checkpoint 1 was green | Bridging layer broken | §4.2 again: Bridged Adapter? correct **Wi-Fi** adapter picked (not Host-Only/NAT)? Cable Connected ticked? Then reboot the VM. If still dead → try Adapter Type `Paravirtualized Network (virtio-net)`; if your setup allows it, use the Ethernet pro tip from §4.4. |
| ping VM ✔ but `nc :22` ✘ | OpenSSH server missing in the VM | You skipped the "Install OpenSSH server" checkbox in §4.5: in the VM console run `sudo apt install -y openssh-server && sudo systemctl enable --now ssh`. |

### 2.5 Checkpoint 3 — SSH session works (after §6)

```bash
ssh "$VM_USER@$VM_IP"           # logs in, no password asked
exit
```

Key-based login with no prompt is the state `./start lan` (and every later
step) expects.

### 2.6 Checkpoint 4 — the cluster ports (after §7 and §9)

These are the three doors the rest of the guide opens through, and the ones
`./start lan` needs open:

| Port | What flows through it | Test from the MacBook, when | Expected |
|---|---|---|---|
| `6443` | kubectl/helm/Ansible → k3s API | after §7 (`k3s` installed) | `nc -vz -w 3 $VM_IP 6443` → *succeeded* |
| `80` | every `http://grogu.test/...` URL, smoke tests | after §9 (ingress-nginx) | `curl -I http://$VM_IP` → `HTTP/1.1 404 Not Found` (nginx default backend — 404 *is* success here) |
| `443` | same, for TLS later (VPS) | after §9 | `nc -vz -w 3 $VM_IP 443` → *succeeded* |

```bash
nc -vz -w 3 "$VM_IP" 6443
nc -vz -w 3 "$VM_IP" 443
curl -I http://"$VM_IP"
```

All four checkpoints green ⇒ "it is all really available": Wi-Fi ✔, VM ✔,
ssh ✔, cluster ports ✔ — everything after this is cluster work, not network
work.

> **Where Windows Firewall does and doesn't matter.** Traffic between the
> MacBook and the **VM** (checkpoints 2–4) is bridged at layer 2: it flows
> over Wi-Fi straight to the VM's own MAC/IP and never traverses the Windows
> network stack — Windows Firewall **cannot** block it, don't chase rules.
> Traffic to the **Windows PC itself** (checkpoint 1, or the NAT fallback in
> the troubleshooting section) *is* filtered by Windows Firewall — that's
> exactly why checkpoint 1 uses a TCP probe instead of trusting ping.

### 2.7 No router access? You don't need it — pick your path here

This guide asks the router for exactly two things, and **neither is
mandatory**: disabling AP/client isolation *if* checkpoint 1 fails, and the
DHCP reservation in §5. If you can't or don't want to touch the home network
settings, read this and pick a path **before** installing anything.

**Case 1 — checkpoint 1 is green (ping *or* `nc` works). This is the common
case: you need the router for nothing.**

- Isolation is off — the router is already doing everything this setup
  requires, and no step in the rest of the guide touches it.
- The only router-flavored step left is §5 "stable IP" — and its **Option B
  (static IP inside the VM)** needs no router access at all. Do Option B,
  continue to §3. Done. (Why Option B needs no router: the VM simply stops
  asking DHCP for an address and claims one itself; the router's job is
  reduced to "route packets", which it does by default for any address in
  the subnet.)

**Case 2 — checkpoint 1 is fully red (ping ✘ *and* `nc` ✘): AP/client
isolation is on and you can't turn it off.** No setting on either laptop can
change what the router refuses to forward: Mac↔PC over this Wi-Fi is dead by
design. The bypass is to stop using the Wi-Fi for Mac↔PC traffic entirely —
plug the two machines into each other. That is **Path B** below.

**Case 3 — checkpoint 1 green, checkpoint 2 red: the Wi-Fi carries
Mac↔PC traffic fine, but the bridged VM stays unreachable.** That's the
known VirtualBox-bridging-over-Wi-Fi driver flakiness — some Wi-Fi
cards/APs silently drop frames whose MAC isn't the host's. Two router-free
fixes: the same **Path B cable** (preferred — it also removes the flaky
component), or **Path C (NAT + standard port forwards)** if a cable is
genuinely impossible.

#### Path B — direct cable MacBook ↔ Windows (recommended; the router is fully out of the loop)

```
MacBook                                 Windows laptop (Wi-Fi kept for internet)
  │  USB-C/Thunderbolt → Ethernet adapter     │  USB → Ethernet adapter
  │  10.10.10.1                               │  10.10.10.2
  └──────────── ordinary Ethernet cable ──────┘
              cable subnet 10.10.10.0/24 — no router, no Wi-Fi, no isolation possible
                        │  VirtualBox: Adapter 1 = Bridged → the USB-Ethernet adapter
                        │               Adapter 2 = NAT (the VM's internet, via Windows Wi-Fi)
                        ▼
                   Ubuntu VM — 10.10.10.3 on the cable NIC
```

Everything you do afterwards is **identical to the rest of this guide** —
same ssh, same `./start lan`, same hosts entries, same smoke tests — every
`$VM_IP` is just `10.10.10.3`. What changes is only how the three endpoints
get addresses:

1. **Hardware**: one ordinary Ethernet cable plus a USB-C/Thunderbolt →
   Ethernet adapter per machine (~$15 each; ASIX- or Realtek-based adapters
   work on macOS out of the box). If both machines have built-in Ethernet
   ports, no adapters. (A Thunderbolt-cable-only link also exists, but
   Windows-side support is driver luck — prefer USB-Ethernet.)
2. **Windows side** — give the USB adapter a static address, and *no*
   gateway (internet keeps flowing over its Wi-Fi). Admin PowerShell:
   ```powershell
   Get-NetAdapter                          # find the USB adapter's name, e.g. "Ethernet 2"
   Set-NetIPInterface -InterfaceAlias "Ethernet 2" -Dhcp Disabled
   New-NetIPAddress -InterfaceAlias "Ethernet 2" -IPAddress 10.10.10.2 -PrefixLength 24
   ```
3. **MacBook side** — same idea, no gateway. System Settings → Network → the
   new "USB 10/100/1000 LAN" service → Details… → TCP/IP → Configure IPv4:
   **Manually**, IP `10.10.10.1`, Subnet `255.255.255.0`, Router **empty**.
   Or in Terminal:
   ```bash
   networksetup -listallnetworkservices                        # find the USB adapter's name
   sudo networksetup -setmanual "USB 10/100/1000 LAN" 10.10.10.1 255.255.255.0
   ```
   An empty Router is the trick that makes coexistence work: the Mac keeps
   using Wi-Fi as its default route and only sends `10.10.10.x` over the
   cable. Both machines keep their normal internet.
4. **Checkpoint 1, over the cable** (before touching VirtualBox):
   ```bash
   nc -vz -w 3 10.10.10.2 22        # Mac → Windows over the cable
   ```
   (Windows' sshd from §2.2 listens on all interfaces, cable included. No
   router can interfere — this is a 2-meter private Ethernet segment.)
5. **VirtualBox** — two changes to §4.2's Network pane:
   - Adapter 1: Bridged, Name = the **USB Ethernet adapter** (from step 2) —
     this is the cluster network the MacBook talks to.
   - Adapter 2: ✅ enabled, Attached to **NAT** — this is the VM's internet
     pipe (apt, get.k3s.io, image pulls, ArgoCD → git), routed through the
     Windows machine's normal connection. Cluster traffic and internet
     traffic take separate doors; neither can break the other.
6. **Install Ubuntu** as in §4.5 (installer screen 4 shows both NICs — leave
   both on DHCP for now).
7. **Address the VM** — this *replaces §5 entirely*. In the VM:
   ```bash
   IFACE=$(ip -o -4 route show default | awk '{print $5}')         # NAT NIC, e.g. enp0s8
   CABLE=$(ls /sys/class/net | grep -vE "^lo$|$IFACE" | head -1)   # bridged NIC, e.g. enp0s3
   sudo tee /etc/netplan/01-lan-cable.yaml <<EOF
   network:
     version: 2
     ethernets:
       $CABLE:                 # cluster side — static, deliberately NO gateway
         dhcp4: false
         addresses: [10.10.10.3/24]
       $IFACE:                 # internet side — default route + DNS come from here
         dhcp4: true
   EOF
   sudo chmod 600 /etc/netplan/01-lan-cable.yaml && sudo netplan apply
   ip -br a
   # expect: enp0s3 = 10.10.10.3/24, enp0s8 = 10.0.2.15/24 (VirtualBox NAT range)
   curl -sI https://get.k3s.io | head -1     # → HTTP/2 200 — internet via Adapter 2 works
   ```
   The cable address is **permanently stable by construction** — nothing
   assigns 10.10.10.x except you; there is no DHCP on that segment to ever
   change it. §5 can be skipped on this path.
8. **Checkpoint 2/3, over the cable** — from the MacBook:
   `nc -vz -w 3 10.10.10.3 22`, then continue with §6: `ssh-copy-id maxim@10.10.10.3`.
9. **One extra k3s flag in §7** (cable mode only): pin the node IP to the
   cable NIC and teach the API certificate about it — needed only for the
   *manual* §8 kubeconfig path; the `./start lan` ssh-tunnel path works
   without it:
   ```bash
   curl -sfL https://get.k3s.io | sh -s - server --disable traefik --write-kubeconfig-mode 644 \
     --node-ip=10.10.10.3 --tls-san 10.10.10.3
   ```
10. Continue §9–§12 unchanged. Hosts files point `grogu.test … → 10.10.10.3`;
    `ansible/inventory.ini` gets `ansible_host=10.10.10.3`; `./start lan`,
    `make status TARGET=lan` and every URL work as documented.

> **Not recommended:** the in-between variant where the Mac joins a **Windows
> Mobile Hotspot** and the VM bridges to the hotspot adapter. It avoids the
> router too, but bridging onto Microsoft's "Wi-Fi Direct Virtual Adapter"
> is the flakiest combination VirtualBox has — you'd trade a $15 adapter for
> weeks of intermittent ARP weirdness.

#### Path C — NAT with standard port forwards (no cable, no bridging, still no router)

For when Mac↔PC over Wi-Fi is fine but bridged frames are being eaten
(case 3) **and** a cable is genuinely impossible. Idea: give up on the VM
having "its own" LAN presence — hide it behind VirtualBox's default NAT and
let the **Windows host forward the three ports** the setup needs:

1. VirtualBox Adapter 1 = **NAT** (revert §4.2's Bridged choice; drop
   Adapter 2 if you added one). The VM keeps plain DHCP — its address is
   10.0.2.15 on VirtualBox's fixed NAT subnet, stable by construction.
2. Select the VM → Settings → Network → Adapter 1 → **Advanced → Port
   Forwarding**. Add three rules:

   | Name  | Protocol | Host Port | Guest IP    | Guest Port |
   |-------|----------|-----------|-------------|------------|
   | ssh   | TCP      | `2222`    | *(empty)*   | `22`       |
   | http  | TCP      | `80`      | *(empty)*   | `80`       |
   | https | TCP      | `443`     | *(empty)*   | `443`      |

   **Standard ports are the whole point**: with 80/443 forwarded as-is, every
   URL stays `http://grogu.test/` and Keycloak's baked redirect keeps
   matching — login works, no caveats. (Windows normally has nothing else
   listening on 80/443; verify with `netstat -ano | findstr ":80 "`.)
3. Windows Firewall will pop a prompt the first time VirtualBox binds the
   ports — **Allow** (Private networks). That prompt is the exception to the
   "Firewall can't block VM traffic" rule above: in NAT mode everything
   deliberately flows *through* the Windows host, so it's checkpoint-1 rules
   again, not layer-2 bridging.
4. Point everything at the **Windows PC's Wi-Fi IP** (`192.168.1.23`):
   hosts files `grogu.test auth.test … → 192.168.1.23` (§11), and the
   inventory gains a port:
   ```
   lan-vm ansible_host=192.168.1.23 ansible_port=2222 ansible_user=maxim
   ```
   `ansible_port` is honored by ansible, `./start lan`, `./stop lan` and
   `make status TARGET=lan` alike (scripts/remote-env.sh reads it). From the
   MacBook: `ssh-copy-id -p 2222 maxim@192.168.1.23`, and every `$VM_IP` in
   the guide becomes `192.168.1.23`.
5. Trade-offs vs Path B: every packet does an extra NAT hop through the
   Windows host; the VM has no real LAN presence; ports 80/443 on Windows
   become dedicated to this; and if the *Windows* Wi-Fi IP ever changes
   (router reboot), hosts files must be updated. To pin the Windows IP
   itself, give its Wi-Fi adapter a static address exactly like §5 Option B
   — still no router access needed.

**Bottom line:** Case 1 → change nothing, use §5 Option B. Case 2 → Path B.
Case 3 → Path B, or Path C if a cable is out of the question. In no case
does the router need to be touched.

---

## 3. Prepare the Windows host

### 3.1 Verify virtualization is enabled

Open **Task Manager → Performance → CPU** and look for **"Virtualization:
Enabled"**.

- **Disabled** → enable VT-x/AMD-V (Intel) or SVM (AMD) in the BIOS/UEFI:
  reboot into firmware setup (usually `F2`, `Del` or `F12` at boot), find
  "Intel Virtualization Technology" / "SVM Mode" under Advanced/CPU
  settings, enable, save & exit.

### 3.2 Resolve the Hyper-V conflict (performance)

VirtualBox runs *under* Hyper-V if Hyper-V (or WSL2, Docker Desktop, Windows
Sandbox, Core Isolation / Memory Integrity) is active. It works, but the VM
is dramatically slower — you'll see a **green turtle** icon in the VM
status bar. A Kubernetes node is exactly the wrong place to accept that.

For best performance, turn the Hyper-V platform off (Admin PowerShell):

```powershell
bcdedit /set hypervisorlaunchtype off
```

and in **Windows Security → Device security → Core isolation**, turn
**Memory integrity** Off. Reboot.

Then confirm Hyper-V itself is not registered (Admin PowerShell):

```powershell
Disable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -NoRestart
```

> **Trade-off:** while Hyper-V is off, WSL2 / Docker Desktop / Windows
> Subsystem for Android won't run on that PC. If you actively use them there,
> either accept the turtle (it still works) or pick a different Windows box.

### 3.3 Install VirtualBox and download Ubuntu

1. Download **VirtualBox 7.x for Windows hosts** from
   [virtualbox.org/wiki/Downloads](https://www.virtualbox.org/wiki/Downloads)
   and install with defaults. The Extension Pack is optional.
2. Download the **Ubuntu Server 24.04 LTS live ISO** (`*-live-server-amd64.iso`)
   from [ubuntu.com/download/server](https://ubuntu.com/download/server).
   Desktop edition is not needed — this VM is a headless server driven over
   SSH.

---

## 4. Create the VM (VirtualBox, on Windows)

### 4.1 New VM wizard (Machine → New)

| Wizard page  | Value |
|--------------|-------|
| Name         | `k3s-lan` |
| Type / Sub-type | Linux / Ubuntu (64-bit) |
| ISO Image    | the `ubuntu-24.04-live-server-amd64.iso` you downloaded |
| ☐ Skip Unattended Installation | **tick it** — you want manual control (the unattended flow is easy to get wrong, especially around SSH) |
| Base Memory  | **10240 MB** (8192 MB on a 16 GB host that you can't spare 10; 6144 MB on an 8 GB host) |
| Processors   | **4** |
| Hard Disk    | **Create a Virtual Hard Disk Now**, VDI, **Dynamically allocated**, **60 GB** |

> **Why these numbers:** the chart's pods request ~5 Gi (see §1), k3s system
> pods take ~1 Gi — that's the 10 GB; 4 vCPUs because keycloak + krakend +
> the two backends + postgres are all CPU-hungry on boot; "dynamically
> allocated" means the 60 GB VDI grows as filled — it starts at ~a few GB and
> only consumes real disk for what the VM actually writes.

### 4.2 Settings — every pane, reviewed (do this BEFORE first boot)

Open `k3s-lan` → **Settings**. Pane by pane:

**General → Advanced**

| Setting | Value | Why |
|---|---|---|
| Shared Clipboard | `Disabled` | headless server; clipboard bridges invite confusion |
| Drag'n'Drop | `Disabled` | same — files move over ssh/scp |

**System → Motherboard**

| Setting | Value | Why |
|---|---|---|
| Base Memory | `10240 MB` | as chosen in the wizard |
| Boot Order | `Hard Disk`, then `Optical` | after install the disk boots; you may untick Optical afterwards to speed boot |
| Chipset | `ICH9` (or `PIIX3` — the default) | either works; don't touch |
| TPM | `None` | Ubuntu Server doesn't want a TPM (VirtualBox 7 offers it for Windows 11 guests) |
| ✅ Enable EFI | **unticked** | the Ubuntu installer expects legacy+GRUB defaults; EFI complicates boot for zero benefit here |

**System → Processor**

| Setting | Value | Why |
|---|---|---|
| Processor(s) | `4` | |
| Execution Cap | `100%` | never cap below 100 — a throttled k8s node makes probes time out mysteriously |
| ✅ Enable PAE/NX | ticked (default) | |
| ❌ Enable Nested VT-x/AMD-V | **unticked** | nothing virtualizes *inside* this VM; the option only adds fragility |

**System → Acceleration**

| Setting | Value | Why |
|---|---|---|
| Paravirtualization Interface | `Default` (resolves to KVM for Linux guests) | default; leave |
| Hardware Virtualization toggles | all default/on | §3.2 made sure Hyper-V is off, so these bind to the real VT-x/AMD-V |

**Display**

| Setting | Value | Why |
|---|---|---|
| Graphics Controller | `VMSVGA` (default for Linux) | |
| Video Memory | `16 MB` | text console only |
| ❌ Enable 3D Acceleration | **unticked** | server VM, no GUI to accelerate |

**Storage** — the 60 GB VDI on the SATA controller + the ISO in the optical
drive (the wizard attached it). Nothing to change.

**Audio** — ❌ **Enable Audio: unticked.** Headless server.

**Network — the pane that decides whether your MacBook will ever see this
VM:**

| Setting (Adapter 1) | Value | Why |
|---|---|---|
| ✅ Enable Network Adapter | ticked | |
| Attached to | **Bridged Adapter** | the VM gets **its own IP from your router**, directly on the LAN. With the default *NAT* the VM hides behind the Windows host and your MacBook could never reach it. (NAT + port-forwarding *is* the documented last-resort fallback in troubleshooting — but bridged is the real setup.) |
| Name | your **Wi-Fi adapter** (e.g. `Intel(R) Wi-Fi 6 AX201 160MHz` or `Realtek 8822CE…`) — the same adapter `ipconfig` showed the Wi-Fi IP on. **Not** the Ethernet one (unless you do §4.4), **not** "VirtualBox Host-Only Ethernet Adapter" | bridging must happen on the adapter that talks to your router |
| Advanced → Adapter Type | `Intel PRO/1000 MT Desktop` (default) | default works everywhere; if Wi-Fi bridging misbehaves later, `Paravirtualized Network (virtio-net)` is the first thing to try (troubleshooting table) |
| Advanced → Promiscuous Mode | `Deny` | the VM has exactly one MAC address; nothing here needs to sniff others' frames |
| Advanced → ✅ Cable Connected | **ticked** | an unticked "cable" = the VM's NIC sees no link = no IP, no network, silent death |
| Adapters 2–4 | ❌ disabled | one NIC is all a single-node cluster needs |

> **Following §2.7 Path B (direct cable)?** Adapter 1 bridges to the
> **USB-Ethernet adapter** instead of the Wi-Fi one, and you add **Adapter 2
> = NAT** for the VM's internet. **Path C (NAT + port forwards)?** Adapter 1
> is **NAT** instead of Bridged, with port-forward rules. The rest of this
> pane is identical in all three variants.

**Serial Ports** — off. **USB** — `USB 1.1 (OHCI)` or disabled; headless
needs none. **Shared Folders** — none (§8/§10 move files with `scp`).

### 4.3 Verify the VM config from PowerShell (optional but 30 seconds)

```powershell
& 'C:\Program Files\Oracle\VirtualBox\VBoxManage.exe' showvminfo k3s-lan | Select-String 'Memory size|Number of CPUs|NIC 1|Cable connected|Bridge|Attachment'
```

Expect: `Memory size: 10240 MByte`, `Number of CPUs: 4`, `NIC 1: ... MAC:
..., Attachment: Bridged Adapter '<your Wi-Fi adapter>', Cable connected: on`.
If `Attachment` says `NAT` — you're invisible to the Mac; fix before booting.

### 4.4 Pro tip: Ethernet beats Wi-Fi bridging (optional, the rock-solid path)

Bridging over Wi-Fi works on most drivers, but it is the single flakiest
link in this whole chain: some Wi-Fi NICs/Access-Point combos filter frames
that don't originate from the host's own MAC, and enterprise-ish drivers
"helpfully" NAT or drop them. If the Windows laptop can sit next to the
router: plug it in by **Ethernet cable** and bridge Adapter 1 to the
**Ethernet** adapter instead (same pane, different Name). Bridged-over-
Ethernet has no quirks; the MacBook stays on Wi-Fi; everything in this guide
is unchanged — all three IPs just live on the router's subnet.

### 4.5 Start the VM → Ubuntu install walkthrough (every screen)

**Start the VM** → the Ubuntu Server installer boots.

1. Language: `English` → **Done**
2. Keyboard: your layout → **Done**
3. Type: **Ubuntu Server** (default) → **Done**
4. Network: leave **DHCP** on the wired adapter for now (we pin a stable IP in
   step 5) — but **write down the IP shown on this screen**. → **Done**
5. Proxy: empty → **Done**
6. Mirror: default → **Done**
7. Storage: **Use entire disk** (defaults, LVM on/off doesn't matter) →
   **Done** → **Continue** (it will format the virtual disk — that's the
   empty 60 GB VDI, your Windows disk is safe)
8. Profile:
   - Your name: anything
   - Server name: `k3s-lan`
   - Username: this becomes `$VM_USER` (e.g. `maxim`)
   - Password: pick one (you'll only type it for `sudo` — day-to-day access
     is SSH keys after step 6) (e.g. `maxim`)
9. "Upgrade to Ubuntu Pro": **Skip**
10. SSH Setup: ✅ **Install OpenSSH server** ← **the critical checkbox**;
    do NOT import a key here (we copy the MacBook's key in step 6)
11. Featured snaps: select none → **Done**
12. Wait for "Install complete!" → **Reboot** (VirtualBox ejects the ISO
    automatically).

### 4.6 After the reboot: first console login, snapshot, go headless

Log in on the VM console once:

```bash
ip -br a            # note the IP on the wired NIC (usually enp0s3, e.g. 192.168.1.43)
```

Then take a **VirtualBox snapshot** — one click now, a 5-minute rollback
later if the k3s install ever goes sideways: VirtualBox Manager → select
`k3s-lan` → the ☰ (Machine Tools) menu → **Snapshots** → **Take** → name it
`clean-ubuntu`.

Two Windows-side settings that keep the rig alive:

- **Power**: Settings → System → Power → *Screen and sleep* → **Never** sleep
  when plugged in (a sleeping host suspends the VM and the cluster "dies"
  mysteriously).
- The VM keeps running when you close/minimize the VirtualBox window — it
  lives in a background process. You never need the VM console again (except
  `sudo` password emergencies) — everything else happens over SSH from the
  MacBook. Next: §5 pins the VM's IP, then checkpoint 2 in §2.4 proves the
  Mac can reach it.

---

## 5. Give the VM a stable IP

Your hosts files (step 11) will point `grogu.test` etc. at `$VM_IP`. If the
router's DHCP ever hands the VM a *different* address, every URL breaks — so
pin it now. Pick **one** of the two options:

> **No router access?** That's fine: **Option B needs nothing from the
> router** — the VM simply stops asking DHCP and claims an address itself.
> (On the §2.7 Path B cable setup, the cable subnet has no DHCP at all and
> step 7 there replaces this section.)

### Option A — DHCP reservation on the router (needs router admin)

The VM keeps using DHCP but the router always gives it the same address.
**Skip this entirely if you're staying out of the router settings — Option B
below is equally permanent.**

1. Find the VM's MAC address: in VirtualBox, `k3s-lan` → **Settings →
   Network → Adapter 1 → Advanced → MAC Address** (e.g. `0800271AB2C3`), or
   inside the VM: `ip link` → `ether …` on the first NIC.
2. Log into your router's admin UI (usually `http://192.168.1.1`), find
   *DHCP → Address Reservation / Static Leases / "Bind IP-MAC"*, and reserve
   a free address on your subnet — e.g. **`192.168.1.50`** — for that MAC.
3. Inside the VM, renew the lease and confirm:
   ```bash
   sudo dhclient -r && sudo dhclient   # or just reboot the VM
   ip -br a                            # expect the reserved address
   ```

### Option B — static IP inside the VM (no router access needed)

Choose an address unlikely to collide with the router's DHCP pool. **How to
pick without ever seeing the router's settings:** home-router DHCP pools are
almost always in the upper range of the subnet (`.100`–`.254`), so pick from
the low range — **`.20`–`.90`** — and verify your candidate is silent:

```bash
ping -c 1 -W 1 192.168.1.50; echo "exit=$?"   # exit=1 → nobody answered → free
arp -a                                         # on the Mac AND in Windows PowerShell:
                                               # the candidate must appear in neither list
```

A collision, if you're ever unlucky, is loud (both hosts log duplicate-IP
warnings, things flap visibly) — not silent data loss; pick the next address
and `sudo netplan apply` again.

Find your gateway/DNS first:

```bash
ip route | grep default      # "default via 192.168.1.1"  → gateway
resolvectl status | head     # current DNS servers
```

Ubuntu Server's network config is managed by netplan + cloud-init. Disable
cloud-init's network overlay and write a static config:

```bash
sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg <<< 'network: {config: disabled}'
IFACE=$(ip -o -4 route show default | awk '{print $5}')   # usually enp0s3
sudo tee /etc/netplan/01-static.yaml <<EOF
network:
  version: 2
  ethernets:
    $IFACE:
      dhcp4: false
      addresses: [192.168.1.50/24]        # VM_IP/24 — your subnet
      routes:
        - to: default
          via: 192.168.1.1                # your gateway from above
      nameservers:
        addresses: [192.168.1.1, 1.1.1.1]
EOF
sudo chmod 600 /etc/netplan/01-static.yaml
sudo netplan apply
ip -br a    # confirm 192.168.1.50
```

---

## 6. Reach the VM from the MacBook (SSH)

All remaining steps run on the MacBook. First, key-based SSH (this is
checkpoint 3 from §2.5 — if the `nc`/`ping` tests of §2.4 just failed, fix
them there first, ssh won't magically work):

```bash
VM_IP=192.168.1.50
VM_USER=maxim

ping -c 3 "$VM_IP"                      # basic reachability (checkpoint 2)
ssh-keygen -t ed25519                   # only if you don't have ~/.ssh/id_ed25519 yet
ssh-copy-id "$VM_USER@$VM_IP"           # copies your public key into the VM
ssh "$VM_USER@$VM_IP"                   # should log in with NO password prompt
```

If `ssh-copy-id` still asks for the password afterwards, log in with the
password and check `~/.ssh/authorized_keys` inside the VM (or just accept
password auth — it works, just less convenient).

---

## 7. Install k3s on the VM

Still on the VM (or: `ssh "$VM_USER@$VM_IP"` from the MacBook). One command:

```bash
sudo apt update && sudo apt -y full-upgrade
curl -sfL https://get.k3s.io | sh -s - server --disable traefik --write-kubeconfig-mode 644
```

> On the §2.7 **Path B** (direct cable) setup, add the node/cert flags so the
> API speaks the cable address:
> `… sh -s - server --disable traefik --write-kubeconfig-mode 644 --node-ip=10.10.10.3 --tls-san 10.10.10.3`

What the flags mean for *this* repo:

- `--disable traefik` — k3s ships Traefik as its default ingress controller,
  but the chart's Ingress uses `ingressClassName: nginx` (helm-chart ingress
  template). With Traefik gone we install ingress-nginx in step 9.
- `--write-kubeconfig-mode 644` — makes `/etc/rancher/k3s/k3s.yaml`
  world-readable *inside the VM* so step 8's `scp` works without `sudo`.
  Fine on a home LAN; on the future VPS use `sudo cat` + `chown` instead.

Verify (takes ~30 s to settle):

```bash
sudo k3s kubectl get nodes -o wide     # STATUS=Ready, VERSION=v1.3x
sudo k3s kubectl get pods -n kube-system
# expect: coredns, local-path-provisioner, metrics-server, svclb-* (after step 9) — all Running
```

Two things you get for free, relevant to this chart:

- **metrics-server** ships enabled → the nodejs HPA (`1–10 @ CPU 75%`) works.
- **local-path** is the default StorageClass → the `redis-cache-pvc` (which
  has no `storageClassName`) binds automatically. The Postgres static PV
  (`hostPath /data/postgresql`, class `manual`) also works unchanged on this
  single-node cluster — the directory is created on the VM on first mount.

Also check the guest firewall — Ubuntu Server ships with it **inactive**, and
this guide assumes it stays that way:

```bash
sudo ufw status
# "Status: inactive" → done.
# If you enabled it: sudo ufw allow 22,80,443,6443/tcp
```

---

## 8. Take control from the MacBook (kubeconfig)

Back on the **MacBook**, fetch the cluster admin kubeconfig and repoint it
from `127.0.0.1:6443` (its default inside the VM) to the VM's LAN IP:

```bash
cd "/Volumes/ADATA SC750/pet/k8s-helm-sandbox"   # repo root
mkdir -p .local                                   # already gitignored

scp "$VM_USER@$VM_IP:/etc/rancher/k3s/k3s.yaml" .local/k3s-config.yaml
sed -i '' "s|https://127.0.0.1:6443|https://$VM_IP:6443|" .local/k3s-config.yaml

export KUBECONFIG="$PWD/.local/k3s-config.yaml"
kubectl get nodes
```

Expect `STATUS Ready` for `k3s-lan`. The `export` is per-terminal — new
terminal ⇒ re-run it (the last line).

> Why this works remotely: kubeconfig auth is a client certificate, not tied
> to source IP; and port **6443** must be reachable — it is, as long as the
> VM's ufw stays inactive. If you can't open 6443 (future VPS hardening), the
> fallback is an SSH tunnel: `ssh -L 6443:127.0.0.1:6443 $VM_USER@$VM_IP -N`
> in a side terminal, and *don't* run the `sed` (keep `127.0.0.1:6443`).
>
> **§2.7 variants:** on **Path B** (cable), this works as-is *provided* §7
> included `--node-ip=10.10.10.3 --tls-san 10.10.10.3` (otherwise x509: the
> certificate wouldn't list the cable address). On **Path C** (NAT), 6443 is
> deliberately not forwarded — use the SSH-tunnel form with the forwarded
> port: `ssh -p 2222 -L 6443:127.0.0.1:6443 $VM_USER@$WIN_IP -N` and again
> *don't* run the `sed`. (All of this is moot on the `./start lan` path — it
> always brings its own tunnel.)

---

## 9. Install ingress-nginx (from the MacBook)

With `KUBECONFIG` exported:

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace --wait

kubectl get svc -n ingress-nginx ingress-nginx-controller
```

The controller Service is type `LoadBalancer`; k3s's built-in **ServiceLB**
(klipper) answers it and binds the ports **on the VM itself** — this is what
replaces `minikube tunnel`:

```
NAME                       TYPE           EXTERNAL-IP     PORT(S)
ingress-nginx-controller   LoadBalancer   192.168.1.50    80:3xxxx/TCP,443:3xxxx/TCP
```

**Milestone check from the MacBook:**

```bash
curl -I "http://$VM_IP"
```

Expect `HTTP/1.1 404 Not Found` from `nginx` — that is the default backend
answering, and proof that your MacBook can hit the cluster's ingress on port
80. (404 and *not* an error/timeout is the success signal here; there's no
Ingress rule for the bare IP yet.)

---

## 10. Deploy the stack

Still on the MacBook, from the repo root, with `KUBECONFIG` exported:

```bash
# 1) SOPS decryption key — skip if `./start` already works on this Mac (it imports it):
gpg --import demo-secret-key.asc

# 2) Deploy — the exact invocation scripts/local-up.sh uses:
helm secrets upgrade --install ap ./helm-chart -f secrets.yaml --wait --timeout 15m
```

You should see `[helm-secrets] decrypted …` lines and then helm reporting
each resource created. **`ap` is the release name and it is load-bearing**
(the metrics ingress rules reference `<release>-…`; don't change it).

Watch it come up (the first run pulls all images from Docker Hub — a few
minutes):

```bash
kubectl get pods -w
```

Expected order (this matches the chart's init-container design):

1. `postgres-0` starts (its PV creates `/data/postgresql` **on the VM** on
   first mount).
2. `postgres-migration` **Job** runs and seeds `nodejs_numbers=3087`,
   `golang_numbers=1703`, then shows `Completed`.
3. `redis-cache-*`, then `keycloak-*` (both backends and Keycloak sit in init
   containers `wait-for-postgres` / `wait-for-redis` until those answer).
4. `nodejs-back-*`, `golang-back-*`, `krakend-gateway-*` (2 replicas,
   readiness-probes nodejs), `react-front-*`.

All `Running`/`Ready 1/1` → continue. If something sits in `Init:` for >5 min,
jump to troubleshooting.

**Where the data lives:** unlike Minikube (VM-inside-Docker-Desktop), k3s runs
directly on the Ubuntu VM, so Postgres data is at **`/data/postgresql` on the
VM's own disk**. It survives `helm uninstall` and VM reboots. Full reset =
`helm uninstall ap` + `ssh $VM_USER@$VM_IP 'sudo rm -rf /data/postgresql'`.

---

## 11. Point the `*.test` hostnames at the VM

Now every machine that should open the app needs a hosts entry. The four
names match `scripts/local-up.sh`'s `HOST_ENTRIES` exactly.

**macOS (each machine you'll browse/test from):**

```bash
printf '%s grogu.test auth.test prom.test grafana.test\n' "$VM_IP" | sudo tee -a /etc/hosts
dscacheutil -flushcache
curl -s -o /dev/null -w '%{http_code}\n' http://grogu.test/    # → 200 once step 10 is done
```

**Windows (the VM host, so you can browse from there too)** — Admin
PowerShell:

```powershell
Add-Content -Path 'C:\Windows\System32\drivers\etc\hosts' -Value '192.168.1.50 grogu.test auth.test prom.test grafana.test'
ipconfig /flushdns
```

(or open Notepad **as Administrator** and edit
`C:\Windows\System32\drivers\etc\hosts` by hand.)

> **Browser gotcha:** Chrome/Edge "Secure DNS" (DoH) can bypass the hosts
> file. If the browser can't find `grogu.test` while `curl` works, turn off
> *Settings → Privacy and security → Security → Use secure DNS* for that
> browser.

`prom.test` / `grafana.test` will 404 until you enable metrics (day-2
section) — the entries are harmless placeholders.

---

## 12. Smoke tests — the same ones `./start` runs

On the MacBook (plain URLs work once step 11 is done). If you *don't* want to
touch `/etc/hosts` on a given machine, every command has a `--resolve`
variant that fakes DNS per-request — that's the second form below.

```bash
VM_IP=192.168.1.50
CURL="curl -s --max-time 5"
# Without hosts entries, use instead:
# CURL="curl -s --max-time 5 --resolve grogu.test:80:$VM_IP --resolve auth.test:80:$VM_IP"

$CURL -o /dev/null -w 'front        %{http_code}\n' http://grogu.test/
$CURL -o /dev/null -w 'gateway      %{http_code}\n' http://grogu.test/api/healthz
$CURL -o /dev/null -w 'nodejs pub   %{http_code}\n' http://grogu.test/api/v1/nodejs/public
$CURL -o /dev/null -w 'golang pub   %{http_code}\n' http://grogu.test/api/v1/golang/public
$CURL -o /dev/null -w 'fib(10)      %{http_code}\n' http://grogu.test/api/v1/golang/public/fibonacci/10
$CURL -o /dev/null -w 'keycloak     %{http_code}\n' http://auth.test/realms/demorealm
```

All six → `200`. Then the authenticated flow (exactly what `local-up.sh`
does — password grant for the seeded user, then the JWT-guarded endpoints
through KrakenD):

```bash
TOKEN_JSON=$($CURL --max-time 10 \
  -d "grant_type=password&client_id=reactclient&username=demo&password=demo" \
  http://auth.test/realms/demorealm/protocol/openid-connect/token)
TOKEN=$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] && echo "JWT OK" || { echo "FAILED:"; printf '%s\n' "$TOKEN_JSON" | head -c 300; }

$CURL -o /dev/null -w 'nodejs priv  %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://grogu.test/api/v1/nodejs/private
$CURL -o /dev/null -w 'golang priv  %{http_code}\n' -H "Authorization: Bearer $TOKEN" http://grogu.test/api/v1/golang/private
```

Both private calls → `200` (KrakenD validated the RS256 JWT against
Keycloak's JWKS). **With a fresh hosts edit there may be a short delay before
private calls succeed** — KrakenD caches the JWKS and refreshes periodically;
wait ~1 min and retry.

Finally, the human test: open **http://grogu.test/** on the **Windows**
machine's browser, log in `demo / demo`, and click around — that proves the
full LAN path (Windows → Wi-Fi → VM → ingress → SPA → Keycloak → gateway →
APIs).

Keycloak admin console: **http://auth.test/** — the `keycloak.adminName` /
`keycloak.adminPassword` values from `secrets.yaml` (repo defaults:
`admin` / `admin`), realm `demorealm`.

---

## Day-2 operations

All of these run on the MacBook from the repo root — every terminal first
needs `export KUBECONFIG="$PWD/.local/k3s-config.yaml"`.

**Redeploy after chart edits** (the `make upgrade` equivalent — *not*
`make upgrade` itself, that would target local Minikube):

```bash
helm secrets upgrade --install ap ./helm-chart -f secrets.yaml --wait --timeout 15m
```

- Editing `values.yaml` / templates: just re-run.
- Editing `helm-chart/migrations/*.sql`: also bump **`postgres.migration.version`**
  in `values.yaml` — the migration Job is immutable in k8s; a same-version
  change makes the next upgrade fail with "field is immutable".
- **Keycloak realm**: `config/realm-export.json` is imported **only when
  Postgres is empty** (first ever install). To apply realm changes, either
  edit via the admin console, or wipe: `helm uninstall ap` +
  `sudo rm -rf /data/postgresql` on the VM + re-run the deploy (you lose the
  seeded numbers data too — it's re-created by the migration Job).

**Metrics stack** (only with ≥10 GB VM RAM):

```bash
helm secrets upgrade --install ap ./helm-chart -f secrets.yaml --set metrics.enabled=true --wait --timeout 15m
```

Prometheus and Grafana ingress rules render only when enabled, and then
`prom.test` / `grafana.test` start working (Grafana admin password lives in
the kube-prometheus-stack subchart defaults).

**Keep off on the VM:** `--set loadGenerator.enable=true` (20 busybox
replicas hammering nodejs) — that's an HPA demo for a beefier cluster.

**Pause / stop the stack** (keeps the cluster + data):

```bash
helm uninstall ap
# data remains at /data/postgresql on the VM; re-running the deploy command reuses it
```

**Full teardown of the VM rig:**

```bash
# 1) drop the release and the cluster:
ssh "$VM_USER@$VM_IP" 'sudo /usr/local/bin/k3s-uninstall.sh'
# 2) optional: wipe DB data too:
ssh "$VM_USER@$VM_IP" 'sudo rm -rf /data/postgresql'
# 3) remove the hosts lines manually (macOS: /etc/hosts, Windows: drivers\etc\hosts)
# 4) VirtualBox → right-click k3s-lan → Remove → Delete all files
```

---

## Troubleshooting

| Symptom | Cause → Fix |
|---|---|
| `ping` MacBook → Windows IP times out (checkpoint 1, §2.2) | **AP/client isolation** on the router, or a *guest* SSID. Disable isolation in the router UI, or move both machines to the main SSID. |
| ping PC ✘ but `nc -vz PC 22` ✔ (§2.2) | Windows Firewall drops ICMP only — harmless. Optionally add the ICMPv4 allow rule from §2.2 and set the network profile to *Private*. |
| ping PC ✔ but `nc -vz PC 22` ✘ | `sshd` on Windows not installed/started (§2.2): `Get-Service sshd` → `Start-Service sshd`; check firewall rule `OpenSSH-Server-In-TCP`; third-party antivirus firewalls can shadow Windows Firewall. |
| Everything reachable yesterday, nothing today; Mac VPN was on | A VPN hijacks the Mac's routing table. Disconnect the VPN, re-run the §2 checks. |
| Both machines pingable, but after Mac sleep/wake nothing responds | macOS Wi-Fi sometimes comes back in a half-dead state: toggle Wi-Fi off/on, re-`ping`. Also confirm the Mac rejoined the **same** SSID (Apple "ask to join new networks" can wander). |
| VM gets no IP / no internet after switching to Bridged | Wi-Fi-driver bridging quirk. Update VirtualBox; in VM → Settings → Network → Advanced try Adapter Type `Paravirtualized Network (virtio-net)`; ensure *Cable Connected*. Last resort: the NAT fallback below. |
| VM's IP **changed** after a router reboot | You skipped step 5. Do the DHCP reservation (or netplan static), then fix `$VM_IP` in hosts files and `.local/k3s-config.yaml`. |
| `kubectl get nodes` hangs from the MacBook | 6443 blocked → `nc -vz -w 3 $VM_IP 6443` (checkpoint 4); check VM ufw (`sudo ufw status`), or use the SSH-tunnel fallback from step 8. |
| Pod stuck `ImagePullBackOff` | Docker Hub rate limit (anonymous pulls). `kubectl describe pod …` shows it; wait ~10 min and `kubectl delete pod <name>` to retry — images are public, so it's transient. |
| `postgres-0` stuck `Pending` | `kubectl describe pvc postgres-pvc` — it must bind to the static PV `postgres-volume` (class `manual`, hostPath `/data/postgresql`, 1Gi, RWX). If the PVC was re-created after a wipe, `kubectl get pv` should show it `Available`; stale data with wrong permissions → `sudo rm -rf /data/postgresql` on the VM and redeploy. |
| Backends stuck in `Init:` >5 min | They wait for Postgres/Redis: `kubectl logs <pod> --all-containers` — usually Redis if its ConfigMap was edited, or Postgres if `/data/postgresql` has stale permissions from a previous k3s install (`sudo rm -rf /data/postgresql` on the VM and redeploy). |
| `curl $VM_IP` → timeout instead of nginx 404 | ingress-nginx Service has no EXTERNAL-IP: `kubectl get svc -n ingress-nginx` — wait ~30 s for ServiceLB; check `kubectl logs -n kube-system -l k8s-app=klipper-lb`. |
| URLs resolve on MacBook but not in the Windows browser | hosts file not saved as Admin, DNS cache (`ipconfig /flushdns`), or browser **Secure DNS bypassing hosts** — disable it (step 11). |
| Private API smoke returns 401 right after deploy | KrakenD hasn't refreshed its JWKS cache yet — wait ~1 min and retry (step 12). |
| TLS/x509 errors from kubectl after a VM suspend | VM clock drift. On the VM: `sudo hwclock -s`, or enable time sync in VirtualBox (System → Motherboard → Hardware clock in UTC time + resume re-sync). |
| Windows PC went to sleep, everything died | A sleeping host suspends the VM. Set *Settings → System → Power → Screen and sleep → When plugged in, put my device to sleep: Never* while running the rig. |
| Cluster slow / probes flapping after you followed §3.2 partially | Hyper-V is still intercepting (green turtle in the VM status bar). Finish §3.2: `bcdedit /set hypervisorlaunchtype off`, Memory integrity off, reboot. |
| Need to roll back a botched VM state | The `clean-ubuntu` snapshot from §4.6: VirtualBox → Snapshots → select → **Restore**. |

**NAT fallback (Path C in §2.7)** — for "Mac↔PC is fine over Wi-Fi but the
bridged VM stays unreachable" when a cable is out of the question: VM
Adapter 1 = **NAT** + port-forward rules on the VirtualBox NAT engine
forwarding **`80→80`, `443→443`, `2222→22`** (standard ports on purpose —
URLs stay `http://grogu.test/` and Keycloak's baked redirect keeps matching,
so login works). Hosts files point at the **Windows PC's** IP; the inventory
gains `ansible_port=2222` (honored by `./start lan`, `./stop lan`, `make
status TARGET=lan`). Full setup: §2.7 Path C. The old advice to use
non-standard ports (`8080→80`) is obsolete — it broke Keycloak login for no
benefit.

---

*Once this rig is verified end-to-end, moving to a VPS repeats steps 7–12
against a rented Ubuntu box (same k3s install, same deploy command) and adds:
real DNS names instead of hosts files, TLS via cert-manager, and CI/CD — see
the readme's Phase 3 notes for that roadmap.*
