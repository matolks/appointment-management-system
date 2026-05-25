# Appointment Manager

Appointment Manager is a desktop application for filling new appointment openings with eligible patients from a waitlist.

## Calendar

Providers are displayed on the left, and their openings are displayed on the calendar in the center. Clicking an opening shows eligible waitlist patients who can fill that appointment time.

### Features

- Clear/reset the database
- Import and export waitlist data using Excel sheets
- Export, import, restore, and manually clean up local database backups
- Add new openings
- Edit, move, resize, or remove current openings
- Warn when adding or scheduling into a past opening
- Add, edit, or remove providers
- Automatically purge openings 14 days after they have passed

## Waitlist

The waitlist displays all current patients waiting for an appointment. Separate views are available for scheduled patients and removed patients for tracking purposes.

### Features

- Search active, scheduled, and removed patients
- Sort active waitlist patients by date added, name, provider, tier, or status
- Add, edit, or remove patients from the waitlist
- Prevent duplicate or overlapping availability time ranges
- Truncate long reasons in table/card views while allowing the full reason to be viewed when selected
- View scheduled patients
- View removed patients
- Delete scheduled or removed records when needed
- Track patient status across waitlisted, scheduled, and removed sections
- Automatically purge old scheduled records and removed records after 14 days

## Import Requirements

Excel imports support flexible column order when a header row is included. If no valid header row is found, the app expects columns in this order:

`Date Added`, `Name`, `Provider`, `Tier`, `Reason`, `Available Days`, `Available Times`

| Column          | Required | Accepted Header Names                              | Accepted Input Examples                                                                                                            | Notes                                                                                                                                                                                                                                    |
| --------------- | -------: | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date Added      |      Yes | `Date Added`, `Date`                               | `5/24/2026`, `05/24/26`, `5-24-2026`, `5/24`, Excel date cell                                                                      | If no year is given, the current year is used. Excel date cells and Excel serial date numbers are supported. Text like `2026-05-24` is not currently supported.                                                                          |
| Name            |      Yes | `Name`, `Patient`, `Patient Name`                  | `Smith, John`, `John Smith`, `Smith`                                                                                               | `Smith, John` parses as last name `Smith`, first name `John`. `John Smith` parses as first name `John`, last name `Smith`. A single word becomes last name only.                                                                         |
| Provider        |      Yes | `Provider`, `Doctor`                               | `Dr. Smith`, `Smith`, `Jones`                                                                                                      | Any non-empty text works. If the provider does not already exist, the import adds it.                                                                                                                                                    |
| Tier            |      Yes | `Tier`, `Priority`, `Priority Tier`                | `1`, `2`, `3`, `Tier 1`, `Priority 2`, `3 - Routine`                                                                               | The parser looks for the first `1`, `2`, or `3` anywhere in the cell. `Urgent` by itself does not work unless it also contains `1`.                                                                                                      |
| Reason          |       No | `Reason`, `Notes`                                  | `Urgent`, `Semi-urgent`, `Routine`, `Consult`, `Follow-up`                                                                         | If blank, the reason defaults from the tier: Tier 1 → `Urgent`, Tier 2 → `Semi-urgent`, Tier 3 → `Routine`.                                                                                                                              |
| Available Days  |       No | `Dates`, `Available Days`, `Days`                  | `M`, `Mon`, `Monday`, `Tu`, `Tue`, `Tuesday`, `W`, `Wed`, `Wednesday`, `Th`, `Thu`, `Thursday`, `F`, `Fri`, `Friday`, `Any`, blank | Multiple values can be separated by spaces, commas, semicolons, or slashes. Blank or `Any` means any day. Weekends are not supported.                                                                                                    |
| Available Times |       No | `Times`, `Available Times`, `Availability`, `Time` | `8am-12pm`, `8:00am-12:00pm`, `8-12pm`, `1pm-3pm`, `8am to 12pm`, `8am-12pm, 1pm-3pm`, `Any`, blank                                | Multiple time ranges can be separated by commas or semicolons. Blank or `Any` means any time. Times must be within 8:00 AM–6:00 PM, each range must contain at least one full hour, and duplicate or overlapping ranges are not allowed. |

## Database and Backups

Appointment Manager stores data locally using SQLite. The app saves providers, openings, waitlist entries, scheduled records, and removed records so the data persists after the desktop app is closed.

The app includes backup tools for protecting local data. Users can export a full JSON backup, import a previous backup, restore the latest automatic backup, open the backup folder, and manually delete old automatic backups from inside the app.

Backups are separate from Excel imports and exports. Excel files are used for waitlist data transfer, while backups are used to preserve and restore the full local application state.

Automatic backups are kept for up to one year. Older automatic backups are deleted to reduce long term storage of outdated patient records.

## Performance Benchmark

The SQLite persistence layer was benchmarked with generated appointment and waitlist records to validate local storage performance.

| Records | Payload Size | Read p95 | Write p95 |
| ------: | -----------: | -------: | --------: |
|     100 |      33.1 KB | 0.157 ms |  0.904 ms |
|     500 |     164.9 KB | 0.337 ms |  2.051 ms |
|   1,000 |     329.6 KB | 0.555 ms |  3.506 ms |
|   2,500 |     828.7 KB | 1.297 ms | 14.644 ms |
|   5,000 |      1.66 MB | 2.625 ms |  7.922 ms |
|  10,000 |      3.33 MB | 5.520 ms | 15.674 ms |

Raw SQLite primary key lookup measured 0.010 ms p95 across 1,000 reads. A real changed save with backup creation enabled measured 1.884 ms p95 on the current application dataset.

These results show that SQLite lookup time is effectively negligible for the current storage model. The dominant persistence cost is JSON serialization and writing the application state payload, but a 10,000 record generated dataset still remained below 6 ms p95 for reads and below 16 ms p95 for writes.

## Data Privacy

Appointment Manager stores data locally on the user's machine. Patient data, SQLite database files, Excel exports, JSON backups, and backup folders should not be committed to GitHub.

Backups may contain patient records that were later edited, removed, or purged from the active app state.

## Tech Stack

- React
- TypeScript
- Electron
- SQLite
- SheetJS
- CSS

## Screenshots

![Calender Example](examples/calendar-example.png)

![Waitlist Example](examples/waitlist-example.png)

## Future Improvements

- Send automated text messages when scheduling a patient
- Support military time if needed
- Improve scheduling notifications and reminders

## License

All rights reserved.

This code may not be used, copied, modified, distributed, or reused without prior written permission from Vince Matolka.
