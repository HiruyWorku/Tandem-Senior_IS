# Start/Stop Guide for WebRTC demo with TURN

This doc lists the exact commands to start and stop everything so you can run cross‑network calls reliably and avoid burning credits when idle.

## Prereqs
- You already have a GCE VM named `turn-server` (Ubuntu 22.04) in zone `us-central1-a` with coturn installed and enabled.
- Firewall rules exist for the VM tag `turn-server`:
  - UDP 3478
  - UDP 49160–49200
  - TCP 3478

## Start sequence (each session)

1) Start the TURN VM

```bash
gcloud compute instances start turn-server --zone=us-central1-a
```

2) Get the VM public IP (it may change after a stop)

```bash
PUBLIC_IP=$(gcloud compute instances describe turn-server \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo $PUBLIC_IP
```

3) If the public IP changed, update coturn (on the VM) and restart

- SSH into the VM:
```bash
gcloud compute ssh ubuntu@turn-server --zone=us-central1-a
```
- Update external IP in `/etc/turnserver.conf` and restart service:
```bash
sudo sed -i "s/^external-ip=.*/external-ip=${PUBLIC_IP}/" /etc/turnserver.conf
sudo systemctl restart coturn
sudo systemctl status coturn --no-pager -n 20
sudo ss -lntu | grep 3478   # should show tcp/udp on 0.0.0.0:3478
```

4) On your Mac, set env vars for the app (NEW_PUBLIC_IP if changed)

```bash
export TURN_URLS="turn:${PUBLIC_IP}:3478?transport=udp,turn:${PUBLIC_IP}:3478?transport=tcp"
export TURN_USERNAME="turnuser"
export TURN_CREDENTIAL="turnpass"
```

5) Start the Node server

```bash
npm start
```

6) Start ngrok (new terminal)

```bash
ngrok http 3000
```

7) Verify ICE config

- In the browser, open: `https://<your-ngrok-host>/ice-config`
- You should see STUN + the two TURN entries with the current PUBLIC_IP.

8) Join from two networks/devices

- Open the same ngrok HTTPS URL on both devices.
- The call should connect and remote video should render both ways.

## Stop sequence (to save credits)

- Stop Node server: press Ctrl+C in its terminal.
- Stop ngrok: press Ctrl+C in its terminal.
- Stop the TURN VM:
```bash
gcloud compute instances stop turn-server --zone=us-central1-a
```

Notes:
- Stopping the VM halts compute billing; boot disk storage still incurs a small charge.

## Optional quality steps

- Set default zone so you can omit flags:
```bash
gcloud config set compute/zone us-central1-a
```

- Check TURN health on the VM:
```bash
sudo systemctl status coturn --no-pager -n 30
sudo ss -lntu | grep 3478
```

- Deep-dive in Chrome:
  - `chrome://webrtc-internals` → selected candidate pair should be `relay` when TURN is used.

## Troubleshooting quick checks
- `/ice-config` must show your TURN entries with the correct PUBLIC_IP.
- If connect → disconnect/failed: ensure the TURN VM is running, firewall is open, and `external-ip` in `/etc/turnserver.conf` matches the current PUBLIC_IP.
- Some networks block UDP; TCP on 3478 is already configured. TLS (5349) can be added later if needed.
