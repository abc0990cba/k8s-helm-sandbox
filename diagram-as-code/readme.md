# Diagrams as code

The PNG architecture diagrams live here, generated from Python
([mingrammer/diagrams](https://diagrams.mingrammer.com) + graphviz).
The scripts and outputs are **versioned together with the architecture**:

| Path | Version | What it draws |
|---|---|---|
| `base_diagram.py` → `fullstack_app.png` | **v2 (current)** | the polyglot app: 3 backends × 3 databases + the click-analytics pipeline |
| `k8s_diagram.py` → `fullstack_app_in_k8s_cluster.png` | **v2 (current)** | the same stack as Kubernetes objects (deployments, StatefulSets, PVCs, HPAs, netpols, monitoring) |
| `archive/v1/` | v1 (pre-split) | React 18 + two backends sharing one PostgreSQL |

## Regenerate

```bash
pip install diagrams          # once
brew install graphviz         # once
python3 base_diagram.py       # writes fullstack_app.png
python3 k8s_diagram.py        # writes fullstack_app_in_k8s_cluster.png
```

Run from this folder — the scripts write the PNG next to themselves.
The renders are committed, so a doc readers sees the current picture even
without installing anything; regenerate after changing the architecture and
commit both the script and the PNG.

Referenced by [readme.md](../readme.md) and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
(the mermaid diagrams there are the source of truth for flows; these PNGs are
the high-level topology pictures).
