# Deploy to a VirtualBox VM on your LAN (Windows host, Ubuntu guest, k3s)

> **TL;DR available:** once the VM from steps 3–5 exists and
> `ansible/inventory.ini` lists it, `./start lan` does everything below
> (Ansible bootstrap + ArgoCD deploy + smoke tests) in one command — see
> [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md) for the flow and
> [gitops/README.md](../gitops/README.md) for what it sets up.
> This guide remains the full manual walkthrough and the VM-provisioning
> reference (steps 1–5 are still manual; only steps 7–12 are automated).

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
- You know the router admin password. Step 5 needs it for a DHCP reservation
  (recommended), and the troubleshooting section may need it to disable
  client isolation.

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

## 2. Pre-flight: prove the two machines can talk

Before installing anything, make sure the Wi-Fi actually routes between your
devices. Many routers ship with **AP/client isolation** enabled, which lets
every device reach the internet but *not each other* — that silently breaks
this whole setup.

1. On Windows, find the PC's IP (PowerShell):

   ```powershell
   ipconfig    # look at "Wireless LAN adapter Wi-Fi" → IPv4 Address, e.g. 192.168.1.23
   ```

2. On the MacBook:

   ```bash
   ping -c 3 192.168.1.23     # the Windows IP from above
   ```

- **Replies?** Good — continue.
- **Timeouts?** Log into the router and look for a setting named *AP
  Isolation*, *Client Isolation*, *Wireless Isolation*, *Network Segmentation*
  or "Guest network" and disable it (or move both machines off the guest
  network). Re-test.

Windows Firewall is **not** a factor anywhere in this guide: with VirtualBox
bridged networking (step 4) traffic between the MacBook and the VM flows
directly over Wi-Fi to the VM's own MAC/IP and never traverses the Windows
network stack. Don't waste time on firewall rules.

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

**New VM wizard** (Machine → New):

| Wizard page  | Value |
|--------------|-------|
| Name         | `k3s-lan` |
| Type / Sub-type | Linux / Ubuntu (64-bit) |
| ISO Image    | the `ubuntu-24.04-live-server-amd64.iso` you downloaded |
| ☐ Skip Unattended Installation | **tick it** — you want manual control (the unattended flow is easy to get wrong, especially around SSH) |
| Base Memory  | **10240 MB** (8192 MB on a 16 GB host that you can't spare 10; 6144 MB on an 8 GB host) |
| Processors   | **4** |
| Hard Disk    | **Create a Virtual Hard Disk Now**, VDI, **Dynamically allocated**, **60 GB** |

**Then, before starting it — Settings (this is the step that makes the VM
visible on your LAN):**

1. **Network → Adapter 1**:
   - ✅ Enable Network Adapter
   - Attached to: **Bridged Adapter**
   - Name: your **Wi-Fi adapter** (e.g. `Intel(R) Wi-Fi 6 AX201 …`) — *not*
     the Ethernet one, *not* "VirtualBox Host-Only"
   - Promiscuous Mode: `Deny` (default, fine)
   - Advanced → ✅ **Cable Connected**
   - Why bridged: the VM gets its **own IP from your router**, directly on
     the Wi-Fi. With the default NAT the VM hides behind the Windows host and
     your MacBook could never reach it. (NAT + port-forwarding *is* the
     documented fallback in the troubleshooting section, but use bridged
     first.)
2. Everything else — defaults are fine.

**Start the VM** → the Ubuntu Server installer boots.

### Ubuntu install walkthrough (every screen)

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
     is SSH keys after step 6)
9. "Upgrade to Ubuntu Pro": **Skip**
10. SSH Setup: ✅ **Install OpenSSH server** ← **the critical checkbox**;
    do NOT import a key here (we copy the MacBook's key in step 6)
11. Featured snaps: select none → **Done**
12. Wait for "Install complete!" → **Reboot** (VirtualBox ejects the ISO
    automatically).

After the reboot, log in on the VM console once, confirm the IP, and shut the
console window down to a headless state:

```bash
ip -br a            # note the IP on the wired NIC (usually enp0s3, e.g. 192.168.1.43)
```

You never need the VirtualBox window again (except `sudo` password prompts in
 emergencies) — everything else happens over SSH from the MacBook.

---

## 5. Give the VM a stable IP

Your hosts files (step 11) will point `grogu.test` etc. at `$VM_IP`. If the
router's DHCP ever hands the VM a *different* address, every URL breaks — so
pin it now. Pick **one** of the two options:

### Option A — DHCP reservation on the router (recommended)

The VM keeps using DHCP but the router always gives it the same address.

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

### Option B — static IP inside the VM (no router access)

Set this only if you can't do the reservation. Choose an address unlikely to
collide with the DHCP pool (e.g. `.50` in a pool that starts at `.100` —
check the pool in your router UI if possible). Find your gateway/DNS first:

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

All remaining steps run on the MacBook. First, key-based SSH:

```bash
VM_IP=192.168.1.50
VM_USER=maxim

ping -c 3 "$VM_IP"                      # basic reachability (worked in step 2 via the PC)
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
| `ping` MacBook → Windows IP times out (step 2) | **AP/client isolation** on the router, or a *guest* SSID. Disable isolation in the router UI, or move both machines to the main SSID. |
| VM gets no IP / no internet after switching to Bridged | Wi-Fi-driver bridging quirk. Update VirtualBox; in VM → Settings → Network → Advanced try Adapter Type `Paravirtualized Network (virtio-net)`; ensure *Cable Connected*. Last resort: the NAT fallback below. |
| VM's IP **changed** after a router reboot | You skipped step 5. Do the DHCP reservation (or netplan static), then fix `$VM_IP` in hosts files and `.local/k3s-config.yaml`. |
| `kubectl get nodes` hangs from the MacBook | 6443 blocked → check VM ufw (`sudo ufw status`), or use the SSH-tunnel fallback from step 8. |
| Pod stuck `ImagePullBackOff` | Docker Hub rate limit (anonymous pulls). `kubectl describe pod …` shows it; wait ~10 min and `kubectl delete pod <name>` to retry — images are public, so it's transient. |
| `postgres-0` stuck `Pending` | `kubectl describe pvc postgres-pvc` — it must bind to the static PV `postgres-volume` (class `manual`, hostPath `/data/postgresql`, 1Gi, RWX). If the PVC was re-created after a wipe, `kubectl get pv` should show it `Available`; stale data with wrong permissions → `sudo rm -rf /data/postgresql` on the VM and redeploy. |
| Backends stuck in `Init:` >5 min | They wait for Postgres/Redis: `kubectl logs <pod> --all-containers` — usually Redis if its ConfigMap was edited, or Postgres if `/data/postgresql` has stale permissions from a previous k3s install (`sudo rm -rf /data/postgresql` on the VM and redeploy). |
| `curl $VM_IP` → timeout instead of nginx 404 | ingress-nginx Service has no EXTERNAL-IP: `kubectl get svc -n ingress-nginx` — wait ~30 s for ServiceLB; check `kubectl logs -n kube-system -l k8s-app=klipper-lb`. |
| URLs resolve on MacBook but not in the Windows browser | hosts file not saved as Admin, DNS cache (`ipconfig /flushdns`), or browser **Secure DNS bypassing hosts** — disable it (step 11). |
| Private API smoke returns 401 right after deploy | KrakenD hasn't refreshed its JWKS cache yet — wait ~1 min and retry (step 12). |
| TLS/x509 errors from kubectl after a VM suspend | VM clock drift. On the VM: `sudo hwclock -s`, or enable time sync in VirtualBox (System → Motherboard → Hardware clock in UTC time + resume re-sync). |
| Windows PC went to sleep, everything died | A sleeping host suspends the VM. Set *Settings → System → Power → Screen and sleep → When plugged in, put my device to sleep: Never* while running the rig. |

**NAT fallback** (only if bridged Wi-Fi proves unusable on that PC): switch
the VM adapter to **NAT**, then in VirtualBox add port-forward rules
Host `8080`→Guest `80`, `8443`→`443`, `16443`→`6443`. Point hosts files at
the **Windows PC's** LAN IP with URLs like `http://grogu.test:8080/` —
however Keycloak's baked redirect (`http://grogu.test/`, port 80) won't match
non-standard ports, so login breaks. NAT is therefore a *last-resort API
smoke* mode, not a real environment — fix bridged networking instead.

---

*Once this rig is verified end-to-end, moving to a VPS repeats steps 7–12
against a rented Ubuntu box (same k3s install, same deploy command) and adds:
real DNS names instead of hosts files, TLS via cert-manager, and CI/CD — see
the readme's Phase 3 notes for that roadmap.*
