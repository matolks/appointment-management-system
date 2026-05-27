# Security Notes

These notes document the local storage and protection model for Appointment Manager. They are intended for development, deployment, and maintenance reference.

## Storage Model

Appointment Manager is a local desktop application. It does not use a hosted backend server and does not transmit app data to a remote service.

The app stores its local database under the operating system's application data directory. The database contains the saved application state, including providers, appointment openings, waitlist entries, scheduled records, and removed records.

## Encryption Model

The saved SQLite app state is encrypted before being stored.

The encryption key is generated locally on the user's computer and protected by the operating system through Electron `safeStorage`. The key is not hardcoded and should not be committed to the repository.

Because the key is protected by the local operating system account, encrypted backups are intended to restore on the same computer that created them. Moving data to another computer may require a separate migration process.

## Backups

Backup files are encrypted before being written to disk.

Automatic backups are created before major data changes such as saves, imports, resets, and restores. Restore operations should skip `before-restore` backups when choosing the latest automatic backup. This prevents the restore action from toggling between the current state and the previously restored state.

Backups may contain records that were later edited, removed, or purged from the active app state. Backup files should be treated as sensitive local records.

## Local File Handling

Do not commit local data files to GitHub.

The repository `.gitignore` should exclude:

- SQLite database files
- SQLite journal, WAL, and SHM files
- backup folders and backup files
- Excel and CSV import/export files
- environment files
- local app data folders
- local key or certificate files

## Electron Security

The Electron renderer should not receive direct Node.js access.

Recommended `BrowserWindow` settings:

```js
webPreferences: {
  preload: path.join(__dirname, "preload.cjs"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
}
```

The preload script should expose only the limited storage API needed by the app.

## Machine Protection

Users should protect the computer account used to run the app.

Full disk encryption, such as BitLocker on Windows or FileVault on macOS, is recommended for additional protection. This is outside the app's control.

If the computer is lost, damaged, or replaced, local data may be unrecoverable unless a compatible backup or migration path is available.

## Migration Limitation

Encrypted backups are currently intended for use on the same machine that created them.

A future migration feature could support one of the following:

- password protected portable export
- admin recovery key
- guided computer migration flow
