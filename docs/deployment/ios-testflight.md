# iOS TestFlight Deployment Guide

This guide explains how to set up and deploy the iOS app to TestFlight.

## Prerequisites

- macOS computer (required for initial Fastlane match setup)
- Apple Developer Program membership ($99/year)
- App created in App Store Connect
- GitHub repository access

---

## Overview

The deployment workflow uses:
- **Fastlane match** - Manages signing certificates and provisioning profiles
- **GitHub Actions** - Automates the build and upload process
- **App Store Connect API** - Uploads builds to TestFlight

---

## Step 1: Create Certificates Repository

Create a **private** GitHub repository to store signing certificates.

1. Go to GitHub → **New repository**
2. Name it something like `ios-certificates`
3. Set visibility to **Private**
4. Do not initialize with README (leave empty)
5. Note the SSH URL: `git@github.com:your-org/ios-certificates.git`

> **Tip:** You can use this same repository for all your iOS apps.

---

## Step 2: Initialize Fastlane Match

This step requires a **Mac** with Xcode installed.

### 2.1 Install Dependencies

```bash
# Install Fastlane
brew install fastlane

# Or via gem
sudo gem install fastlane
```

### 2.2 Navigate to iOS Directory

```bash
cd apps/siutindei_app/ios
```

### 2.3 Initialize Match

```bash
fastlane match init
```

When prompted:
- Select **git** as storage mode
- Enter your certificates repo URL: `git@github.com:your-org/ios-certificates.git`

This updates the `Matchfile` with your repository URL.

### 2.4 Generate Certificates

```bash
# Set your bundle ID
export MATCH_APP_IDENTIFIER="com.yourcompany.customerapp"

# Generate App Store distribution certificate and profile
fastlane match appstore
```

When prompted:
- Enter your Apple ID email
- Enter your Apple ID password (or app-specific password if 2FA enabled)
- Select your team if you belong to multiple
- **Create a passphrase** - This becomes your `MATCH_PASSWORD` (save it securely!)

Match will:
1. Create a distribution certificate (if none exists)
2. Create a provisioning profile for your app
3. Encrypt and store them in your certificates repo

### 2.5 Verify Setup

After completion, check your certificates repo - you should see:
```
certs/
  distribution/
    XXXXXXXX.cer
    XXXXXXXX.p12
profiles/
  appstore/
    AppStore_com.yourcompany.customerapp.mobileprovision
```

---

## Step 3: Configure GitHub Secrets

Go to your **main app repository** → **Settings** → **Secrets and variables** → **Actions** → **Secrets** tab.

### Required Secrets

#### `MATCH_GIT_URL`

The SSH URL of your certificates repository.

**How to get it:**
1. Go to your certificates repo on GitHub
2. Click **Code** → **SSH** tab
3. Copy the URL

**Example:** `git@github.com:your-org/ios-certificates.git`

---

#### `MATCH_PASSWORD`

The passphrase you created when running `fastlane match appstore`.

**How to get it:**
- Use the password you entered during Step 2.4
- If you forgot it, you'll need to run `fastlane match nuke` and start over

**Example:** `MySecurePassword123!`

---

#### `FASTLANE_USER`

Your Apple ID email address.

**How to get it:**
- Use the email associated with your Apple Developer account

**Example:** `developer@yourcompany.com`

---

#### `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`

An app-specific password for your Apple ID (required because of 2FA).

**How to get it:**
1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in with your Apple ID
3. Navigate to **Sign-In and Security** → **App-Specific Passwords**
4. Click **Generate an app-specific password**
5. Enter a label: `Fastlane CI`
6. Click **Create**
7. Copy the generated password

**Example:** `xxxx-xxxx-xxxx-xxxx`

---

#### `AMPLIFY_API_KEY`

Your backend API key for the mobile app to communicate with the API.

**How to get it:**
1. Go to AWS Console → **API Gateway**
2. Select your API
3. Go to **API Keys** in the sidebar
4. Click on your API key
5. Click **Show** and copy the value

**Alternative:** If stored in AWS Secrets Manager or SSM Parameter Store, retrieve from there.

---

#### App Store Connect API Key

You need an API key to upload builds to TestFlight. Choose **one** of these options:

##### Option A: Single JSON Secret (`APPSTORE_API_KEY_JSON`)

**How to get it:**

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Click **Users and Access** in the sidebar
3. Click **Integrations** tab at the top
4. Click **App Store Connect API** in the sidebar
5. Click the **+** button to generate a new key
6. Enter name: `CI Deploy Key`
7. Select Access: **Admin** or **App Manager**
8. Click **Generate**
9. **Immediately download the .p8 file** (one-time download!)
10. Note the **Key ID** from the table
11. Note the **Issuer ID** at the top of the keys section

Create a JSON string:
```json
{
  "issuer_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "key_id": "XXXXXXXXXX",
  "private_key": "-----BEGIN EXAMPLE KEY-----\nMIGTAgEAMBMG...\n-----END EXAMPLE KEY-----"
}
```

> **Important:** Replace newlines in the .p8 file with `\n` for the JSON format.

##### Option B: Individual Secrets

If you prefer separate secrets instead of JSON:

| Secret | Value |
|--------|-------|
| `APPSTORE_ISSUER_ID` | Issuer ID from App Store Connect (UUID format) |
| `APPSTORE_API_KEY_ID` | Key ID (10 characters) |
| `APPSTORE_API_PRIVATE_KEY` | Full contents of `.p8` file including BEGIN/END lines |

---

## Step 4: Configure GitHub Variables

Go to **Settings** → **Secrets and variables** → **Actions** → **Variables** tab.

### Required Variables

#### `IOS_BUNDLE_ID`

Your app's bundle identifier.

**How to get it:**
1. Open `apps/siutindei_app/ios/Runner.xcodeproj` in Xcode
2. Select the **Runner** target
3. Go to **Signing & Capabilities** tab
4. Find **Bundle Identifier**

**Or** check `apps/siutindei_app/ios/Runner.xcodeproj/project.pbxproj` and search for `PRODUCT_BUNDLE_IDENTIFIER`.

**Example:** `com.yourcompany.customerapp`

---

#### `APPLE_TEAM_ID`

Your Apple Developer Team ID.

**How to get it:**
1. Go to [Apple Developer Portal](https://developer.apple.com/account)
2. Look in the top-right corner under your name, or
3. Go to **Membership Details**
4. Find **Team ID**

**Example:** `ABC123XYZ` (10 characters)

---

#### `IOS_PROVISIONING_PROFILE` (Optional)

The name of the provisioning profile for manual signing.

**How to get it:**
- If using Fastlane match, the naming convention is:
  `match AppStore com.yourcompany.customerapp`

**Example:** `match AppStore com.yourcompany.customerapp`

> Leave empty to use automatic signing.

---

### Firebase Variables

If your app uses Firebase, add these variables:

| Variable | Where to Find |
|----------|---------------|
| `FIREBASE_API_KEY` | Firebase Console → Project Settings → Your apps → iOS app |
| `FIREBASE_PROJECT_ID` | Firebase Console → Project Settings → General |
| `FIREBASE_MESSAGING_SENDER_ID` | Firebase Console → Project Settings → Cloud Messaging |
| `FIREBASE_IOS_APP_ID` | Firebase Console → Project Settings → Your apps → iOS app → App ID |
| `FIREBASE_STORAGE_BUCKET` | Firebase Console → Project Settings → General |
| `FIREBASE_APP_CHECK_DEBUG` | (Optional) Debug token for App Check |

---

## Step 5: Set Up GitHub Deploy Key (For SSH Access)

GitHub Actions needs SSH access to your private certificates repository.

### 5.1 Generate SSH Key

```bash
ssh-keygen -t ed25519 -C "github-actions-match" -f match_deploy_key -N ""
```

This creates:
- `match_deploy_key` (private key)
- `match_deploy_key.pub` (public key)

### 5.2 Add Public Key to Certificates Repo

1. Go to your **certificates repository** → **Settings** → **Deploy keys**
2. Click **Add deploy key**
3. Title: `GitHub Actions`
4. Key: Paste contents of `match_deploy_key.pub`
5. Check **Allow write access**
6. Click **Add key**

### 5.3 Add Private Key to Main App Repo

1. Go to your **main app repository** → **Settings** → **Secrets and variables** → **Actions**
2. Add new secret:
   - Name: `MATCH_DEPLOY_KEY`
   - Value: Paste contents of `match_deploy_key` (private key)

### 5.4 Update Workflow (if needed)

Add SSH key setup step to the workflow before the match step:

```yaml
- name: Setup SSH for match
  uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.MATCH_DEPLOY_KEY }}
```

---

## Step 6: Trigger Deployment

### Via GitHub UI

1. Go to your repository → **Actions**
2. Select **Deploy iOS** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**

### Via GitHub CLI

```bash
gh workflow run deploy-ios.yml
```

### Via Git Tag (if configured)

```bash
git tag ios-v1.0.0
git push origin ios-v1.0.0
```

---

## Step 7: Access TestFlight Build

1. Go to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app
3. Click **TestFlight** tab
4. Wait for Apple to process the build (5-30 minutes)
5. Once processed, the build appears under **iOS Builds**

### Add Testers

1. In TestFlight, go to **Internal Testing** or **External Testing**
2. Create a group or select existing
3. Add testers by email
4. Testers receive an invitation to install via TestFlight app

---

## Troubleshooting

### "No signing certificate found"

- Ensure `fastlane match appstore` was run successfully
- Verify `MATCH_GIT_URL` points to correct repo
- Check `MATCH_PASSWORD` is correct

### "Provisioning profile doesn't match bundle identifier"

- Verify `IOS_BUNDLE_ID` variable matches your app's bundle ID
- Re-run `fastlane match appstore` with correct `MATCH_APP_IDENTIFIER`

### "App Store Connect API authentication failed"

- Verify API key has Admin or App Manager role
- Check `APPSTORE_ISSUER_ID` and `APPSTORE_API_KEY_ID` are correct
- Ensure `.p8` private key content is complete (including BEGIN/END lines)

### "SSH authentication failed for certificates repo"

- Ensure deploy key is added to certificates repo with write access
- Verify `MATCH_DEPLOY_KEY` secret contains the private key
- Check SSH key setup step runs before match step

---

## Configuration Checklist

### Secrets
- [ ] `MATCH_GIT_URL`
- [ ] `MATCH_PASSWORD`
- [ ] `MATCH_DEPLOY_KEY`
- [ ] `FASTLANE_USER`
- [ ] `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD`
- [ ] `AMPLIFY_API_KEY`
- [ ] `APPSTORE_API_KEY_JSON` (or individual secrets)

### Variables
- [ ] `IOS_BUNDLE_ID`
- [ ] `APPLE_TEAM_ID`
- [ ] `IOS_PROVISIONING_PROFILE` (optional)
- [ ] Firebase variables (if applicable)

### One-Time Setup
- [ ] Private certificates repo created
- [ ] `fastlane match appstore` run on Mac
- [ ] Deploy key configured for certificates repo
- [ ] App registered in Apple Developer Portal
- [ ] App created in App Store Connect
