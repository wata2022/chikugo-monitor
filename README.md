# 筑後大堰 水位・潮位グラフ

筑後大堰の上流・下流水位を取得し、筑後大堰に近い潮位地点として若津の潮位予測と重ねてグラフ化します。

## セットアップ

```powershell
python -m pip install -r requirements.txt
```

## 第1段階: 水位だけ取得

```powershell
python stage1_water_level.py
```

出力:

- `water_level.csv`
- `water_level.png`

`water_level.csv` には以下の列が入ります。

- `downstream_water_level_tpm`
- `upstream_water_level_tpm`

## 第2段階: 潮位を自動取得して重ねる

標準では tide736 API から、筑後大堰に近い潮位地点として `若津`
（佐賀県、`pc=41`, `hc=8`）の潮位予測を自動取得します。

```powershell
python stage2_water_tide.py
```

出力:

- `tide_auto.csv`
- `merged.csv`
- `graph.png`
- `daily_graphs/graph_YYYYMMDD.png`

`graph.png` は左軸に下流水位・上流水位 TPm、右軸に若津潮位 cm を表示します。
`daily_graphs` フォルダには、同じ内容を1日単位の表示範囲に分けたグラフを出力します。

自動取得できない場合だけ、`tide.csv` を同じフォルダに置くとCSVにフォールバックします。
強制的にCSVだけを使う場合は次のように実行します。

```powershell
python stage2_water_tide.py --no-auto-tide --tide-csv tide.csv
```

`tide.csv` は以下のどちらかの形式に対応しています。

```csv
datetime,tide_cm
2026/06/30 23:00,150
2026/06/30 24:00,180
```

```csv
date,time,tide_cm
2026/06/30,23:00,150
2026/06/30,24:00,180
```

日本語列名の `日時`, `潮位`, `潮位(cm)` も読み取れます。
`06/30 24:00` のような表記は、翌日の `00:00` として処理します。

## サンプル実行

潮位データの実ファイルがまだない場合は、動作確認用の `tide_sample.csv` を使えます。

```powershell
python stage2_water_tide.py --tide-csv tide_sample.csv --merged-csv merged_sample.csv --graph graph_sample.png
```

## テスト

```powershell
python -m unittest -v test_water_tide.py
```
