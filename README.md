# 露營日誌 Camping Log

和朋友一起規劃露營的網頁 App。建立行程後用房間碼或邀請連結邀朋友加入，一起分配公用裝備、打包自己的行李、列購物清單、記帳分攤；露營回來補上照片和心得，就成了你們的露營紀錄。

- 網址：<https://tiffany880402.github.io/camping-log/>
- 前端：純 JavaScript + Vite，GitHub Actions 自動部署到 GitHub Pages
- 登入：Firebase Authentication（Google 登入）
- 資料：Cloud Firestore（即時同步，沒網路時也能看、能勾，連上後自動同步）
- 照片：壓縮後存在 Firestore，不需要付費方案

## 第一次設定

### 1. GitHub
1. 這個 repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
2. 之後每次推到 `main`，網站會在 1～2 分鐘內自動更新。

### 2. 建立 Firebase 專案
1. 到 <https://console.firebase.google.com> 按「建立專案」，名稱例如 `camping-log`。Google Analytics 可以關掉。
2. 專案首頁按 **`</>`（網頁）** 圖示新增網頁應用程式，暱稱隨意，不用勾 Firebase Hosting。
3. 畫面上會出現 `firebaseConfig = { ... }`，把裡面六個值貼進 **`public/firebase-config.js`** 對應的位置，commit。

### 3. 開啟 Google 登入
1. 左側「建構 → Authentication」→「開始使用」。
2. 「登入方式」→ **Google** → 啟用 → 選支援電子郵件 → 儲存。
3. 「設定」→「已授權網域」→ 新增 **`tiffany880402.github.io`**。

### 4. 建立資料庫
1. 左側「建構 → Firestore Database」→「建立資料庫」。
2. 位置選 **`asia-east1`（台灣）**，模式選「正式版模式」。
3. 到「規則」分頁，把 **`firestore.rules`** 整份貼上，按「發布」。

## 從舊版搬資料
舊版（tiffany880402.github.io/camping）右上角有「匯出資料」，存下檔案後，在新版首頁最下方按「從舊版露營日誌匯入資料」選擇檔案即可。匯入的行程金額只當紀錄，不算進統計。

## 本機開發
```bash
npm install
npm run dev
```

## 資料結構
| 路徑 | 內容 |
|---|---|
| `users/{uid}` | 名字、頭像（給同行的人看） |
| `data/users/{uid}/trips` | 我加入了哪些行程（只有本人看得到） |
| `data/users/{uid}/kit` | 我的常用裝備，標記公用或個人（只有本人看得到） |
| `trips/{tripId}` | 行程資訊、房間碼、建立者、手動加的同行者、心得 |
| `trips/{tripId}/members/{uid}` | 成員 |
| `trips/{tripId}/gear` | 公用裝備：誰帶、是否已裝好 |
| `trips/{tripId}/packs/{uid}` | 每個人自己的行李清單 |
| `trips/{tripId}/shopping` | 購物清單 |
| `trips/{tripId}/expenses` | 支出：金額、誰先付、哪些人分攤 |
| `trips/{tripId}/photos` | 照片 |

每個項目分開存，兩個人同時勾選不會互相覆蓋。
