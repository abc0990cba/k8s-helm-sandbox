# Переключение окружений: Gitea ↔ GitHub, локальный registry ↔ Docker Hub, OrbStack ↔ VPS

> Документ-ответ на вопрос «а как перейти от локальной разработки к
> production-ready, и можно ли совать туда-сюда». Короткий ответ: **да, можно,
> и это заложено в архитектуру**. Каждый компонент вашей локальной схемы — это
> уменьшенная копия продакшн-компонента. Переключение = смена адресов и
> пары строк в конфигах, а не переделка архитектуры.
>
> Уровень: начинающий. Перед чтением useful прочитать
> [HOW-DEPLOY-WORKS-RU.md](./HOW-DEPLOY-WORKS-RU.md) — там объяснено, что такое
> Helm, ArgoCD и как коммит доезжает до кластера.

---

## 1. Четыре компонента и их «близнецы»

| Роль | Локальный вариант (сейчас) | Продакшн-вариант (потом) |
|---|---|---|
| Где лежит код | **Gitea** — `http://localhost:3000` (контейнер на Mac) | **GitHub** — `github.com/abc0990cba/k8s-helm-sandbox` |
| Где собираются образы | **Gitea Actions** + act_runner (контейнер на Mac) | **GitHub Actions** (облачные раннеры) |
| Где хранятся образы | **registry:2** внутри машины k3s — `192.168.139.195:30500` | **Docker Hub** (`mmko67/*`) или ghcr.io |
| Где работает кластер | **OrbStack-машина** на этом же Mac | **VPS** (k3s на арендованном Linux) + TLS |
| Кто деплоит | **ArgoCD** — одинаково в обоих случаях | тот же ArgoCD |

Почему это работает: ни Helm, ни ArgoCD, ни чарт не знают, где живёт git,
registry или кластер — им нужны только адреса. Адреса собраны в нескольких
конкретных местах (раздел 4), и меняем мы только их.

### Матрица совместимости (что с чем сочетается)

| CI ↓ \ Registry → | локальный registry (`…:30500`) | Docker Hub / ghcr |
|---|---|---|
| **Gitea Actions** (раннер на Mac) | ✔ — **текущий режим** | ✔ (нужен `docker login`) |
| **GitHub Actions** (облачные раннеры) | ✘ — облако не видит вашу приватную сеть `192.168.139.x` | ✔ |
| **GitHub Actions** (self-hosted раннер на Mac) | ✔ | ✔ |

| Кластер ↓ \ Registry → | локальный registry | Docker Hub (публичные образы) |
|---|---|---|
| **OrbStack (k3s на Mac)** | ✔ — **текущий режим** | ✔ (кластер тянет из интернета) |
| **VPS / lan** | ✘ — VPS не видит ваш Mac | ✔ |

Читается так: **облачный CI не умеет пушить в локальный registry**, а **VPS не
умеет пуллить из локального registry**. Отсюда два устойчивых сочетания:

- **Полностью локально** (сейчас): Gitea + локальный registry + OrbStack.
  Код не покидает Mac.
- **Полностью продакшн**: GitHub + Docker Hub/ghcr + VPS. Код публичен
  (или приватен в GitHub), образы — в облачном registry.

Переход между ними — это три «рычага» (раздел 3) и один переезд кластера
(раздел 5).

---

## 2. Текущее состояние — что уже настроено на этой машине

| Компонент | Где работает | Как создан | Данные/конфиг |
|---|---|---|---|
| Gitea | контейнер `gitea` на Mac, порт 3000 | `scripts/orbstack-gitea.sh` | админ `ci-admin`, пароль в `.local/gitea-credentials.txt` |
| act_runner | контейнер `gitea-runner` на Mac | там же | конфиг `~/.orbstack-gitea/runner-config.yaml` |
| registry:2 | **под в кластере** (namespace `registry`, NodePort 30500) | `scripts/orbstack-registry.sh` | каталог: `http://192.168.139.195:30500/v2/_catalog` |
| git-daemon | systemd-сервис внутри машины (порт 9418) | `scripts/orbstack-local-git.sh` | раздаёт `.local/gitops-origin.git` (ArgoCD его смотрит) |

Git- remote в рабочей копии:

```
gitea   http://ci-admin:***@localhost:3000/ci-admin/k8s-helm-sandbox.git   (push: локальный CI)
origin  https://github.com/abc0990cba/k8s-helm-sandbox.git                (fetch: GitHub)
        + два push-URL: Gitea И GitHub (один `git push origin main` — в оба)
```

Пайплайн: `.gitea/workflows/build-deploy.yml` — на push в `main` собирает
**только изменённые сервисы**, пушит их в registry с тегом = git-SHA, коммитом
бота обновляет версии в `helm-chart/values-orbstack.yaml` и зеркалирует `main`
в репозиторий, который смотрит ArgoCD.

---

## 3. Три рычага переключения

### Рычаг 1 — git-сервер: Gitea ↔ GitHub

**Что меняется:** куда вы делаете `git push` и куда смотрит ArgoCD.

*Gitea → GitHub (перенос кода, кластер остаётся локальным):*

```bash
git remote add github https://github.com/abc0990cba/k8s-helm-sandbox.git
git push github main          # однократно — вся история
# дальше: каждый git ship / git push github main — GitHub снова актуален
```

ArgoCD при этом **не трогаем** — он продолжает смотреть на локальный remote
(см. ниже), деплоит он всё равно из git, а из какого сервера вы запушили — ему
без разницы, главное чтобы обе копии были синхронны.

*ArgoCD переключить на GitHub (для lan/vps так и есть по умолчанию):*

1. В `ansible/group_vars/orbstack.yml` закомментируйте строку
   `repo_url: "git://…"` — ArgoCD возьмёт адрес из
   `ansible/group_vars/all.yml` (GitHub).
2. `./start orbstack --skip-bootstrap` — Ansible перевыполнит роль argocd:
   `root-app` и `project` будут указывать на GitHub.
3. Проверка: `orb -m k3s-orbstack -u ubuntu sudo k3s kubectl -n argocd get
   application root -o jsonpath='{.spec.source.repoURL}'` → `https://github.com/…`.

*GitHub → Gitea (обратно):* разкомментируйте `repo_url`, повторите
`./start orbstack --skip-bootstrap`.

> ⚠️ **Но учтите: у облачного GitHub Actions нет доступа к вашему локальному
> registry** (матрица в разделе 1). Поэтому «GitHub как CI для локального
> OrbStack» требует либо self-hosted раннер на Mac (сценарий А, раздел 5),
> либо переход registry на Docker Hub (рычаг 2).

### Рычаг 2 — CI: Gitea Actions ↔ GitHub Actions

Файл пайплайна один и тот же, меняется только папка:

| | Gitea Actions | GitHub Actions |
|---|---|---|
| Папка | `.gitea/workflows/build-deploy.yml` | `.github/workflows/build-deploy.yml` |
| Раннеры | act_runner на Mac (контейнер `gitea-runner`) | облачные (VPS-режим) или self-hosted на Mac |
| Секреты | `CIGITCREDS` (repo → Settings → Actions → Secrets) | те же имена в Settings → Secrets → Actions |

Переключение Gitea → GitHub (когда кластер и registry уже «облачные»):

```bash
mkdir -p .github/workflows
git mv .gitea/workflows/build-deploy.yml .github/workflows/build-deploy.yml
```

И три правки внутри файла — все уже размечены комментариями:

1. `REGISTRY:` → `docker.io/mmko67` (или `ghcr.io/<user>`);
2. клон/пуш: вместо `GITEA_CREDS` GitHub даёт автоматически
   `${{ secrets.GITHUB_TOKEN }}` + переменные `GITHUB_SERVER_URL` /
   `GITHUB_REPOSITORY` — или просто оставьте `actions/checkout@v4` вместо
   ручного `git clone`;
3. `runs-on: docker` → `runs-on: ubuntu-latest`.

Обратно (GitHub → Gitea): `git mv` папки в обратную сторону и возврат
`REGISTRY:` на локальный registry.

### Рычаг 3 — хранилище образов: локальный registry ↔ Docker Hub / ghcr

**Что меняется:** одна переменная в пайплайне + права на запись.

*Локальный registry → Docker Hub:*

1. В `.gitea/workflows/build-deploy.yml` (или в GitHub-версии файла) поменяйте
   `REGISTRY:` на `docker.io/mmko67`.
2. Добавьте логин в пайплайне перед `docker push`:
   ```yaml
   - name: Docker Hub login
     run: docker login -u "$DOCKERHUB_USER" -p "$DOCKERHUB_TOKEN"
     env:
       DOCKERHUB_USER: ${{ secrets.DOCKERHUB_USER }}
       DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}
   ```
   (в GitHub те же имена — в Settings → Secrets).
3. В `values-orbstack.yaml` (и позже в `values-vps.yaml`) строки `image:`
   станут `docker.io/mmko67/grogu-front` — кластер тянет публичные образы
   без дополнительных настроек. Если образы приватные — понадобится
   `imagePullSecrets` (см. FAQ).
4. Локальный registry можно остановить: `orb -m k3s-orbstack -u ubuntu sudo
   k3s kubectl -n registry scale deployment/registry --replicas=0`.

*Обратно:* вернуть `REGISTRY:` на `192.168.139.195:30500`, `scale --replicas=1`.

> **Почему нельзя оставить локальный registry и уехать на VPS:** VPS физически
> не видит `192.168.139.x` — это адрес внутри вашего Mac. Правило простое:
> **registry живёт там же, где его читают** — локальный для OrbStack,
> облачный для VPS.

---

## 4. Шпаргалка: что меняется в каких файлах

| Файл | Что там переключается |
|---|---|
| `.gitea/workflows/build-deploy.yml` | `REGISTRY:` (адрес registry), имя папки при переезде на GitHub |
| `helm-chart/values-orbstack.yaml` | `image:`-ссылки (туда пишет CI; формат `\<registry\>/\<name\>:\<sha\>`) |
| `ansible/group_vars/orbstack.yml` | `repo_url:` — откуда ArgoCD читает чарт (закомментировано = GitHub) |
| `ansible/group_vars/all.yml` | `repo_url:` по умолчанию — GitHub |
| `ansible/inventory.ini` | адрес машины (за вас правит `orbstack-create.sh`) |
| `~/.orbstack-gitea/runner-config.yaml` | конфиг раннера (docker socket) |

Автоматизация: `scripts/orbstack-local-git.sh` при каждом запуске проверяет IP
машины и сам обновляет `inventory.ini`, `group_vars/orbstack.yml`,
`gitops/apps/orbstack/ap.yaml`, `.gitea/workflows/build-deploy.yml` и
`values-orbstack.yaml`.

---

## 5. Сценарии «переезда» — пошагово

### Сценарий А. GitHub как зеркало + локальный деплой (то, что уже включено)

Это состояние «два источника сразу»: Gitea — триггер деплоя, GitHub —
полная копия.

```bash
git remote add github https://github.com/abc0990cba/k8s-helm-sandbox.git
git push github main
```

Дальше либо пушьте в оба (см. `git ship` ниже), либо ограничьтесь Gitea и
изредка синхронизируйте GitHub вручную.

Уже настроено в этом репозитории: у `origin` **два push-URL** —
`git push origin main` уносит `main` и в Gitea, и в GitHub одновременно
(проверка: `git remote -v` — две строки `origin … (push)`).

Чтобы одной командой получать и CI-коммиты, и пушить в оба:
```bash
git ship    # = git pull --rebase gitea main && git push origin main (двойной push)
```

### Сценарий Б. Полный production: GitHub + Docker Hub + VPS

1. **VPS** — создайте машину (Ubuntu 24.04, 4 vCPU/8 GB), добавьте её в
   `ansible/inventory.ini` группу `[vps]`; полный разбор —
   [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md).
2. **`./start vps`** — тот же Ansible-плейбук поднимет k3s + ArgoCD на VPS;
   ArgoCD там сразу смотрит на GitHub.
3. **`helm-chart/values-vps.yaml`** — домены, `tls.enabled: true`,
   `tls.email` (смотрите TODO-комментарии внутри).
4. **Образы**: переключите рычаг 2 на GitHub Actions + рычаг 3 на Docker Hub
   (раздел 3) — пайплайн начнёт собирать образы в облаке и пушить их в Hub;
   VPS скачает их сам. Или соберите и запушьте образы руками:
   `scripts/build-front.sh <tag>`, `docker push …` — и поднимите `version:` в
   `values-vps.yaml`.
5. **TLS** включится сам: cert-manager (ставится ролью `cert_manager`) получит
   сертификаты Let's Encrypt для доменов из `values-vps.yaml`.

### Сценарий В. Обратно на локальный режим

1. `./stop vps` (если был VPS) — ArgoCD-apps удаляются, кластер остаётся.
2. Верните рычаги: `REGISTRY:` → локальный, папку workflows → `.gitea/…`.
3. `./start orbstack` — машина, k3s и ArgoCD уже на месте, деплой из
   локального remote.

---

## 6. Чек-лист после любого переключения

```bash
./start <цель> --skip-bootstrap   # или полный запуск
make status TARGET=<цель>         # ArgoCD: Healthy/Synced?
# смоук-тесты прогоняются сами; вручную:
curl -s http://<app-host>/ | head -3
orb -m k3s-orbstack -u ubuntu sudo k3s kubectl get pods   # (локальная цель)
```

- ArgoCD `Healthy/Synced` — кластер совпадает с git;
- `OutOfSync` — норм, автосинк применит через ≤3 мин;
- `ComparisonError` — ошибка рендера: смотрите сообщения в статусе приложения.

---

## 7. FAQ

**`git push` в Gitea отвергается «non-fast-forward».**
CI сделал бот-коммит (обновление версий образов) — ваш локальный `main`
отстал. `git pull --rebase gitea main` и повторите push. Либо `git ship` —
он делает это сам.

**Запушил в GitHub, а в OrbStack ничего не поменялось.**
Переключатель «куда смотрит ArgoCD» — `repo_url` в
`ansible/group_vars/orbstack.yml`. Сейчас он смотрит на локальный git-daemon,
а CI-пайплайн зеркалирует туда `main`. Если зеркалирование не запускалось
(например, вы пушили только в GitHub) — ArgoCD и не должен ничего замечать:
запустите `./scripts/orbstack-local-git.sh`.

**Где веб-интерфейс CI?**
`http://localhost:3000/ci-admin/k8s-helm-sandbox/actions` — вкладка Actions:
статусы всех запусков, логи по шагам, кнопка Re-run.

**Как вернуть всё к «заводскому» локальному состоянию?**
`./stop orbstack --purge` (кластер), `orb delete k3s-orbstack` (машина),
`docker rm -f gitea gitea-runner && docker volume rm gitea-data` (Gitea),
`./scripts/orbstack-registry.sh` пересоздаст registry. Потом заново:
`./scripts/orbstack-create.sh && ./scripts/orbstack-local-git.sh && ./start
orbstack`.

**Что НЕ уедет на GitHub никогда?**
`.local/` (пароли, bare-репозиторий, kubeconfig) и
`ansible/inventory.ini` (реальные IP машин) — в `.gitignore`. Всё остальное,
включая зашифрованный `secrets.yaml` и демо-GPG-ключ, — уезжает намеренно.

---

## 8. Карта документов

| Документ | Про что |
|---|---|
| [RUN.md](./RUN.md) | команды запуска всех окружений (быстрая справка) |
| [HOW-DEPLOY-WORKS-RU.md](./HOW-DEPLOY-WORKS-RU.md) | путь коммита: git → CI → registry → ArgoCD → кластер |
| [DEPLOY-VPS-ARGOCD.md](./DEPLOY-VPS-ARGOCD.md) | полный гайд по VPS: выбор, цены, TLS, Day-2 |
| [DEPLOY-LAN-VIRTUALBOX.md](./DEPLOY-LAN-VIRTUALBOX.md) | вариант «машина не на Mac, а в VirtualBox на Windows» |
| [gitops/README.md](../gitops/README.md) | практики GitOps в этом репозитории |
