# GitHub Setup Guide — SaloonBossX

This guide walks you through connecting the app to GitHub so users get
automatic update notifications in Settings and you can publish new APK
versions with a single git command.

---

## Step 1 — Create a GitHub account & repository

1. Sign up at https://github.com if you don't have an account
2. Click **New repository**
3. Name it `SaloonBossX` (or any name you prefer)
4. Set visibility to **Public** (required for free GitHub Releases)
5. Click **Create repository**

---

## Step 2 — Push this code to GitHub

Open a terminal in the project folder and run:

```bash
git init
git add .
git commit -m "Initial commit — SaloonBossX v2.4.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/SaloonBossX.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your actual GitHub username.

---

## Step 3 — Update the app config

Open `src/services/UpdateService.ts` and set your GitHub details:

```typescript
export const GITHUB_OWNER   = 'YOUR_GITHUB_USERNAME'; // ← Your GitHub username
export const GITHUB_REPO    = 'SaloonBossX';           // ← Your repo name (must match)
export const CURRENT_VERSION = '2.4.0';                // ← Keep in sync with app.json
```

---

## Step 4 — Set up EAS (for auto APK builds)

This lets GitHub automatically build and publish the APK when you create a
new version tag — no manual building needed.

1. Create an Expo account at https://expo.dev
2. Install EAS CLI:
   ```bash
   npm install -g eas-cli
   eas login
   eas build:configure
   ```
3. Create an EAS token:
   - Go to https://expo.dev/accounts/[username]/settings/access-tokens
   - Click **Create token**, name it `GITHUB_ACTIONS`, copy the token

4. Add the token to GitHub:
   - In your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Name: `EXPO_TOKEN`, Value: (paste the token)
   - Click **Add secret**

---

## Step 5 — Create an EAS build profile

Create `eas.json` in the project root:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "production": {
      "android": {
        "buildType": "apk",
        "gradleCommand": ":app:assembleRelease"
      }
    }
  }
}
```

---

## Step 6 — Releasing a new version (how to push updates)

When you want to ship a new version to your users:

### 1. Update the version number in two places

In `app.json`:
```json
"version": "2.5.0"
```

In `src/services/UpdateService.ts`:
```typescript
export const CURRENT_VERSION = '2.5.0';
```

### 2. Commit and tag

```bash
git add .
git commit -m "Release v2.5.0 — [describe what changed]"
git tag v2.5.0
git push origin main
git push origin v2.5.0
```

### 3. GitHub Actions takes over automatically

- GitHub detects the new tag `v2.5.0`
- Runs the build workflow (takes ~15-20 minutes)
- Creates a release at https://github.com/YOUR_USERNAME/SaloonBossX/releases
- Attaches the built APK file to the release

### 4. Users see the update

- When users open Settings in the app, it checks GitHub
- An **"Update Available"** banner appears with the version number
- They tap **Download Update** → APK downloads → they install it

---

## Manual APK release (without EAS / GitHub Actions)

If you prefer to build the APK manually:

1. Build the APK:
   ```bash
   eas build --platform android --profile production
   # Download the APK from the EAS dashboard
   ```

2. Create a GitHub release manually:
   - Go to https://github.com/YOUR_USERNAME/SaloonBossX/releases/new
   - Tag: `v2.5.0` (must start with `v`)
   - Title: `SaloonBossX v2.5.0`
   - Drag and drop your `.apk` file into the assets area
   - Click **Publish release**

Users will see the update notification within 1 hour (the cache TTL).

---

## Troubleshooting

**"Update Available" never shows even after publishing a release**
- Check that `GITHUB_OWNER` and `GITHUB_REPO` in `UpdateService.ts` match exactly
- Verify the release tag starts with `v` (e.g. `v2.5.0`, not `2.5.0`)
- The version in the tag must be higher than `CURRENT_VERSION`
- Try tapping "Check for Updates" manually in Settings to bypass the 1-hour cache

**GitHub Actions build fails**
- Make sure `EXPO_TOKEN` secret is set in repo Settings → Secrets → Actions
- Make sure `eas.json` exists in the project root
- Check the Actions tab on GitHub for detailed error logs
