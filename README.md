# 筑後大堰 若津 水位・潮位モニター

筑後大堰の水位と若津の潮位を表示するPWAです。AndroidスマホのChromeで開き、ホーム画面に追加できます。

公開URLの想定:

```text
https://wata2022.github.io/chikugo-monitor/
```

## GitHub Pages構成

GitHub Pagesで公開するファイルは `docs/` にまとめています。

- `docs/index.html`
- `docs/style.css`
- `docs/app.js`
- `docs/manifest.json`
- `docs/service-worker.js`
- `docs/merged.csv`
- `docs/icons/icon-192.png`
- `docs/icons/icon-512.png`

PWAは `docs/merged.csv` を読み込み、Plotlyで水位と潮位のグラフを表示します。更新ボタンは、Cloudflare WorkerのURLを設定している場合はGitHub Actionsを起動し、元データを再取得します。未設定の場合は、GitHub Pages上の最新 `merged.csv` を再取得します。

## GitHub Pagesの設定方法

1. GitHubで `chikugo-monitor` リポジトリを作成します。
2. このリポジトリの内容を `master` ブランチへpushします。
3. GitHubのリポジトリ画面で `Settings` を開きます。
4. 左メニューの `Pages` を開きます。
5. `Build and deployment` の `Source` を `Deploy from a branch` にします。
6. `Branch` を `master`、フォルダを `/docs` にして `Save` します。
7. 数分後に次のURLで公開されます。

```text
https://wata2022.github.io/chikugo-monitor/
```

## データ更新

手元で更新する場合:

```powershell
python -m pip install -r requirements.txt
python stage2_water_tide.py --merged-csv docs/merged.csv
```

更新後、`docs/merged.csv` をcommitしてpushすると公開ページに反映されます。

## GitHub Actionsによる自動更新

`.github/workflows/update.yml` を用意しています。内容は以下です。

- 10分ごとに自動実行
- 手動実行も可能
- Python依存関係をインストール
- `stage2_water_tide.py` を実行
- `docs/merged.csv`、`water_level.csv`、`tide_auto.csv` に変更があればcommitしてpush

初回利用時は、GitHubのリポジトリ設定でActionsの書き込み権限を有効にしてください。

1. `Settings` を開きます。
2. `Actions` -> `General` を開きます。
3. `Workflow permissions` で `Read and write permissions` を選びます。
4. `Save` します。

手動実行する場合は、GitHubの `Actions` タブから `Update monitor data` を選び、`Run workflow` を押します。

## アプリの更新ボタンで元データを更新する

GitHub Pagesは静的サイトなので、ブラウザからPythonを直接実行できません。アプリの更新ボタンで元データを取りに行くには、Cloudflare WorkerからGitHub Actionsの `workflow_dispatch` を呼び出します。

Worker本体は `cloudflare-worker/update-trigger.js` です。

Cloudflare Workerに設定する環境変数:

```text
GITHUB_TOKEN=GitHub Actionsを起動できるトークン
UPDATE_KEY=自分だけが知っている更新キー
ALLOWED_ORIGIN=https://wata2022.github.io
GITHUB_OWNER=wata2022
GITHUB_REPO=chikugo-monitor
GITHUB_WORKFLOW_ID=update.yml
GITHUB_REF=master
```

`GITHUB_TOKEN` と `UPDATE_KEY` は必ずWorkerのSecretとして設定し、リポジトリには書かないでください。

GitHub fine-grained tokenの権限:

```text
Repository: wata2022/chikugo-monitor
Actions: Read and write
Contents: Read-only
```

Cloudflare Workerを公開したら、`docs/app.js` と `app.js` の `UPDATE_TRIGGER_URL` にWorkerのURLを設定します。

```js
const UPDATE_TRIGGER_URL = "https://your-worker-name.your-subdomain.workers.dev";
```

更新ボタンを押すと更新キーの入力欄が表示されます。正しい更新キーを入力した場合だけ、GitHub Actionsが起動します。

## ローカル確認

PWAとservice workerは `file://` では正しく動きません。ローカル確認はHTTPサーバーで行います。

```powershell
python -m http.server 8000 -d docs
```

ブラウザで次を開きます。

```text
http://127.0.0.1:8000/
```

## 主なスクリプト

- `stage1_water_level.py`: 筑後大堰の水位データを取得
- `stage2_water_tide.py`: 水位と若津潮位を結合し、`merged.csv` を生成
- `test_water_tide.py`: CSV処理と潮位処理のテスト

テスト:

```powershell
python -m unittest -v test_water_tide.py
```
