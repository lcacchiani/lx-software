# Android Play Store Deployment Guide

This guide explains how to set up and deploy the Android app to Google Play Store.

## Prerequisites

- Google Play Developer account ($25 one-time fee)
- App created in Google Play Console
- GitHub repository access

---

## Overview

The deployment workflow uses:
- **Android App Bundle (AAB)** - Modern Android distribution format
- **Keystore signing** - Signs the app for release
- **Google Play API** - Uploads builds automatically
- **GitHub Actions** - Automates the build and upload process

---

## Step 1: Create a Signing Keystore

The keystore contains your app's signing key. This is critical - **if you lose it, you cannot update your app**.

### 1.1 Generate Keystore

Run this command on your local machine:

```bash
keytool -genkey -v \
  -keystore release-keystore.p12 \
  -storetype PKCS12 \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias release
```

When prompted, enter:
- **Keystore password** - Create a strong password (save this as `ANDROID_KEYSTORE_PASSWORD`)
- **Key password** - Can be same as keystore password (save this as `ANDROID_KEY_PASSWORD`)
- **Your name, organization, etc.** - Fill in your details

### 1.2 Verify Keystore

```bash
keytool -list -v -keystore release-keystore.p12 -storetype PKCS12
```

Note the **alias name** - this becomes `ANDROID_KEY_ALIAS` (default is `release` if you used the command above).

### 1.3 Store Keystore Securely

**Critical:** Back up your keystore file and passwords in a secure location (password manager, secure cloud storage). If lost, you cannot push updates to your app.

---

## Step 2: Create Google Play Service Account

This allows GitHub Actions to upload builds to the Play Store.

### 2.1 Enable Google Play Developer API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing one
3. Go to **APIs & Services** → **Library**
4. Search for **Google Play Android Developer API**
5. Click **Enable**

### 2.2 Create Service Account

1. In Google Cloud Console, go to **IAM & Admin** → **Service Accounts**
2. Click **Create Service Account**
3. Enter details:
   - Name: `play-store-deploy`
   - ID: `play-store-deploy`
4. Click **Create and Continue**
5. Skip the optional steps, click **Done**

### 2.3 Create Service Account Key

1. Click on the newly created service account
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Select **JSON** format
5. Click **Create**
6. **Save the downloaded JSON file** - this becomes `GOOGLE_PLAY_SERVICE_ACCOUNT`

### 2.4 Link Service Account to Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Click **Settings** (gear icon) → **API access**
3. If prompted, link to your Google Cloud project
4. Find your service account in the list
5. Click **Manage Play Console permissions**
6. Grant these permissions:
   - **View app information and download bulk reports** (read-only)
   - **Release to production, exclude devices, and use Play App Signing**
   - **Manage testing tracks and edit tester lists**
7. Click **Invite user** → **Send invitation**
8. Click **Apply** on the API access page

### 2.5 Grant App-Level Access

1. In Play Console, go to your app
2. Go to **Setup** → **API access**
3. Find your service account
4. Click **Manage** under App permissions
5. Check your app
6. Click **Apply**

---

## Step 3: Set Up Play App Signing (Recommended)

Google Play App Signing lets Google manage your upload key, providing better security and key recovery options.

### 3.1 Enroll in Play App Signing

1. In Play Console, go to your app
2. Go to **Release** → **Setup** → **App signing**
3. Choose one of:
   - **Use Google-generated key** (recommended for new apps)
   - **Export and upload a key from Java Keystore** (if you have existing users)
4. Follow the prompts to complete enrollment

### 3.2 Upload Key vs App Signing Key

With Play App Signing:
- **Upload key** - What you use to sign AABs for upload (your keystore)
- **App signing key** - What Google uses to sign APKs for distribution

If you lose your upload key, Google can help you reset it. Without Play App Signing, losing your key means losing your app.

---

## Step 4: Configure GitHub Secrets

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab.

### Required Secrets

#### `ANDROID_KEYSTORE_BASE64`

Your keystore file encoded in Base64 format.

**How to get it:**

```bash
# On macOS/Linux
base64 -i release-keystore.p12

# On Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release-keystore.p12"))
```

Copy the entire output (it will be a long string).

---

#### `ANDROID_KEYSTORE_PASSWORD`

The password you set when creating the keystore.

**Example:** `MySecureKeystorePassword123!`

---

#### `ANDROID_KEY_ALIAS`

The alias of the key in your keystore.

**How to get it:**

```bash
keytool -list -keystore release-keystore.p12 -storetype PKCS12
```

Look for the alias name in the output (e.g., `release`).

**Example:** `release`

---

#### `ANDROID_KEY_PASSWORD`

The password for the key (often same as keystore password).

**Example:** `MySecureKeyPassword123!`

---

#### `GOOGLE_PLAY_SERVICE_ACCOUNT`

The full contents of the service account JSON file you downloaded in Step 2.3.

**How to get it:**

1. Open the downloaded JSON file
2. Copy the entire contents

**Example:**

Store the full JSON content in the secret value and keep it out of
source control. Avoid pasting the credentials into documentation.

---

#### `AMPLIFY_API_KEY`

Your backend API key.

**How to get it:**
1. Go to AWS Console → **API Gateway**
2. Select your API → **API Keys**
3. Copy the API key value

---

## Step 5: Configure GitHub Variables

Go to **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.

### Required Variables

#### `ANDROID_PACKAGE_NAME`

Your app's package name (application ID).

**How to get it:**

Check `apps/siutindei_app/android/app/build.gradle.kts`:
```kotlin
defaultConfig {
    applicationId = "com.yourcompany.customerapp"
    ...
}
```

**Example:** `com.lxsoftware.siutindei`

---

#### `ANDROID_RELEASE_TRACK`

The Play Store release track for uploads.

**Options:**
| Track | Description |
|-------|-------------|
| `internal` | Internal testing (up to 100 testers, instant availability) |
| `alpha` | Closed testing |
| `beta` | Open testing |
| `production` | Public release |

**Recommended:** Start with `internal` for testing, then promote to other tracks.

**Example:** `internal`

---

### Firebase Variables

If your app uses Firebase, add these variables:

| Variable | Where to Find |
|----------|---------------|
| `FIREBASE_API_KEY` | Firebase Console → Project Settings → Your apps → Android app |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase Console → Project Settings → Cloud Messaging |
| `FIREBASE_ANDROID_APP_ID` | Firebase Console → Project Settings → Your apps → Android app → App ID |
| `FIREBASE_STORAGE_BUCKET` | Firebase Console → Project Settings → General |
| `FIREBASE_APP_CHECK_DEBUG` | (Optional) Debug token for App Check |

---

## Step 6: Create App in Play Console (First Time)

Before automated uploads work, you must manually upload the first AAB.

### 6.1 Build AAB Locally

```bash
cd apps/siutindei_app

# Install dependencies
flutter pub get

# Build release AAB
flutter build appbundle --release
```

The AAB will be at: `build/app/outputs/bundle/release/app-release.aab`

### 6.2 Upload First Build Manually

1. Go to [Google Play Console](https://play.google.com/console)
2. Select your app (or create new one)
3. Go to **Release** → **Testing** → **Internal testing**
4. Click **Create new release**
5. Upload your `app-release.aab` file
6. Fill in release notes
7. Click **Save** → **Review release** → **Start rollout**

After this initial upload, the GitHub Actions workflow can upload subsequent builds automatically.

---

## Step 7: Trigger Deployment

### Via GitHub UI

1. Go to your repository → **Actions**
2. Select **Deploy Mobile App** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**

### Via Push to Main

The workflow automatically triggers on pushes to `main` that modify:
- `apps/siutindei_app/**`
- `packages/flutter_ui/**`
- `packages/api_client_dart/**`
- `packages/models_shared/**`

### Via GitHub CLI

```bash
gh workflow run deploy-mobile.yml
```

---

## Step 8: Access Play Store Build

1. Go to [Google Play Console](https://play.google.com/console)
2. Select your app
3. Go to **Release** → **Testing** → **Internal testing** (or your configured track)
4. The new build will appear after processing (usually 5-15 minutes)

### Add Internal Testers

1. Go to **Internal testing** → **Testers** tab
2. Create a testers list or use existing
3. Add tester emails
4. Share the opt-in link with testers

Testers can install via:
- Play Store (after opting in)
- Direct link from Play Console

---

## Troubleshooting

### "App signing certificate not found"

- Ensure `ANDROID_KEYSTORE_BASE64` is correctly encoded
- Verify keystore password is correct
- Check that the key alias matches

### "Authentication failed" for Play Store upload

- Verify service account has correct permissions
- Ensure service account is linked to the app in Play Console
- Check `GOOGLE_PLAY_SERVICE_ACCOUNT` contains valid JSON

### "Version code already exists"

- Increment `versionCode` in `pubspec.yaml` or `build.gradle.kts`
- Each upload must have a unique, higher version code

### "Package name mismatch"

- Verify `ANDROID_PACKAGE_NAME` matches `applicationId` in `build.gradle.kts`
- Package name cannot be changed after first upload

### Build fails with signing error

- Check all four signing secrets are set correctly
- Verify keystore format is PKCS12 (`.p12` extension)
- Ensure passwords don't contain special characters that need escaping

---

## Local Development Setup

For testing release builds locally:

### 1. Create Local Key Properties

```bash
cd apps/siutindei_app/android
cp key.properties.example key.properties
```

### 2. Edit key.properties

```properties
storePassword=your-keystore-password
keyPassword=your-key-password
keyAlias=release
storeFile=keystore.p12
```

### 3. Copy Keystore

```bash
cp /path/to/release-keystore.p12 apps/siutindei_app/android/app/keystore.p12
```

### 4. Build Locally

```bash
cd apps/siutindei_app
flutter build appbundle --release
```

> **Note:** Never commit `key.properties` or `keystore.p12` to git.

---

## Release Tracks Workflow

Recommended promotion flow:

```
internal → alpha → beta → production
   ↓         ↓       ↓         ↓
 Dev QA   Team    Public    Everyone
         testing  beta
```

### Promote a Release

1. Go to Play Console → your app
2. Go to the current track (e.g., Internal testing)
3. Click **Promote release**
4. Select target track
5. Review and roll out

---

## Configuration Checklist

### Secrets
- [ ] `ANDROID_KEYSTORE_BASE64`
- [ ] `ANDROID_KEYSTORE_PASSWORD`
- [ ] `ANDROID_KEY_ALIAS`
- [ ] `ANDROID_KEY_PASSWORD`
- [ ] `GOOGLE_PLAY_SERVICE_ACCOUNT`
- [ ] `AMPLIFY_API_KEY`

### Variables
- [ ] `ANDROID_PACKAGE_NAME`
- [ ] `ANDROID_RELEASE_TRACK`
- [ ] Firebase variables (if applicable)

### One-Time Setup
- [ ] Keystore created and backed up securely
- [ ] Google Cloud project created with Play Developer API enabled
- [ ] Service account created with JSON key
- [ ] Service account linked to Play Console with permissions
- [ ] App created in Play Console
- [ ] First AAB uploaded manually
- [ ] Play App Signing enabled (recommended)
