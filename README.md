# Kotlin Learning Tracker

A long-lived progress tracker for studying the official Kotlin documentation. The frontend is a responsive glass-style static web app for GitHub Pages; authentication, private per-user progress and the shared documentation catalog use Firebase.

## Architecture

- GitHub Pages: HTML/CSS/Vanilla JavaScript frontend
- Firebase Authentication: Google Sign-In
- Cloud Firestore: per-user progress + shared documentation catalog
- Cloud Functions (2nd gen, `us-central1`): fast update checks and explicit catalog refreshes
- Source of truth: JetBrains `kotlin-web-site`, especially `docs/kr.tree` and `docs/topics`

## First deployment

1. In Firebase Console, open **Project settings → Your apps → Kotlin Learning Tracker Web → SDK setup and configuration** and copy the exact `apiKey` into `src/firebase-config.js`. The value previously returned by Firebase Gemini looked synthetic, so it is intentionally not committed.
2. In **Authentication → Settings → Authorized domains**, add `ferhatsanli.github.io`.
3. Clone this repository locally and install the Firebase CLI if necessary.
4. From the repository root run:

   ```bash
   firebase login
   cd functions && npm install && cd ..
   firebase deploy --only firestore,functions
   ```

5. Sign into the web app once, then find your Firebase Authentication UID.
6. Assign the `admin: true` custom claim to that UID from a trusted Admin SDK environment. Sign out/in afterwards so the ID token refreshes.
7. In the app, open **Settings → Update documentation** to build the initial catalog.
8. Enable GitHub Pages for the `main` branch/root directory.

## Progress model

Each Google user gets private progress under `users/{uid}/progress/{pageId}`. The documentation catalog is shared and read-only to browser clients. Only the Admin SDK in Cloud Functions can update it.

Pages in the Kotlin Tour Beginner section before **Null safety** are initialized as completed. Intermediate Tour pages are labeled as review material. These defaults can later be migrated into explicit per-user progress if desired.

## Documentation updates

`checkDocumentationUpdate` performs a lightweight revision check and is called after login. `updateDocumentation` is admin-only and rebuilds the catalog from JetBrains' navigation tree and source Markdown while preserving user progress references and deprecating removed pages.

## Important

Do not place Firebase Admin SDK service-account credentials, GitHub personal access tokens, or other secrets in this repository. Firebase Web configuration is public client configuration; authorization is enforced by Authentication, Firestore rules and backend custom claims.
