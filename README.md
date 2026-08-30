# Kotlin Learning Tracker

A long-lived progress tracker for studying the official Kotlin documentation. The frontend is a responsive glass-style static web app for GitHub Pages; authentication, private per-user progress and the shared documentation catalog use Firebase.

## Architecture

- GitHub Pages: HTML/CSS/Vanilla JavaScript frontend
- Firebase Authentication: Google Sign-In
- Cloud Firestore: per-user progress + shared documentation catalog
- Source of truth: JetBrains `kotlin-web-site`, especially `docs/kr.tree` and `docs/topics`

## First deployment

1. Clone this repository locally and install the Firebase CLI if necessary.
2. From the repository root run:

   ```bash
   firebase login
   firebase deploy --only auth,firestore
   ```

3. Sign into the web app with an account that already has the `admin: true` custom claim. Sign out/in after any claim change so the ID token refreshes.
4. In the app, open **Settings → Update documentation** to build the initial catalog client-side.
5. Enable GitHub Pages for the `main` branch/root directory.

## Progress model

Each Google user gets a private lesson status under `users/{uid}/progress/{pageId}`: `toLearn`, `review` or `completed`. Existing `completed` progress remains backward-compatible. The documentation catalog is shared and read-only to regular users. An authenticated user with the `admin: true` claim can update it directly from the browser under the Firestore rules.

Pages in the Kotlin Tour Beginner section before **Null safety** default to completed, while Intermediate Tour pages default to Review. A user's explicit status always overrides these catalog defaults.

## Documentation updates

The browser performs a lightweight revision check after login. The admin-only update action rebuilds the catalog from JetBrains' navigation tree and source Markdown while preserving user progress references and deprecating removed pages.

## Important

Do not place Firebase Admin SDK service-account credentials, GitHub personal access tokens, or other secrets in this repository. Firebase Web configuration is public client configuration; authorization is enforced by Authentication, Firestore rules and backend custom claims.
