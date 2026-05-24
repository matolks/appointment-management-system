# Appointment Manager

Appointment Manager is a desktop application for filling new appointment openings with eligible patients from a waitlist.

## Calendar

Providers are displayed on the left, and their openings are displayed on the calendar in the center. Clicking an opening shows eligible waitlist patients who can fill that appointment time.

### Features

- Clear/reset the database
- Import and export data using Excel sheets
- Add new openings
- Edit or remove current openings
- Add, edit, or remove providers
- Automatically purge openings 14 days after they have passed

## Waitlist

The waitlist displays all current patients waiting for an appointment. Separate views are available for scheduled patients and removed patients for tracking purposes.

### Features

- Search active, scheduled, and removed patients
- Sort active waitlist patients by date added, name, provider, tier, or status
- Add, edit, or remove patients from the waitlist
- View scheduled patients
- View removed patients
- Track patient status across waitlisted, scheduled, and removed sections

## Import Requirements

Excel imports support flexible column order when a header row is included. If no valid header row is found, the app expects columns in this order:

`Date Added`, `Name`, `Provider`, `Tier`, `Reason`, `Available Days`, `Available Times`

| Column          | Required | Accepted Header Names                              | Accepted Input Examples                                                                                                            | Notes                                                                                                                                                                                  |
| --------------- | -------: | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date Added      |      Yes | `Date Added`, `Date`                               | `5/24/2026`, `05/24/26`, `5-24-2026`, `5/24`, Excel date cell                                                                      | If no year is given, the current year is used. Excel date cells and Excel serial date numbers are supported. Text like `2026-05-24` is not currently supported.                        |
| Name            |      Yes | `Name`, `Patient`, `Patient Name`                  | `Smith, John`, `John Smith`, `Smith`                                                                                               | `Smith, John` parses as last name `Smith`, first name `John`. `John Smith` parses as first name `John`, last name `Smith`. A single word becomes last name only.                       |
| Provider        |      Yes | `Provider`, `Doctor`                               | `Dr. Smith`, `Smith`, `Jones`                                                                                                      | Any non-empty text works. If the provider does not already exist, the import adds it.                                                                                                  |
| Tier            |      Yes | `Tier`, `Priority`, `Priority Tier`                | `1`, `2`, `3`, `Tier 1`, `Priority 2`, `3 - Routine`                                                                               | The parser looks for the first `1`, `2`, or `3` anywhere in the cell. `Urgent` by itself does not work unless it also contains `1`.                                                    |
| Reason          |       No | `Reason`, `Notes`                                  | `Urgent`, `Semi-urgent`, `Routine`, `Consult`, `Follow-up`                                                                         | If blank, the reason defaults from the tier: Tier 1 → `Urgent`, Tier 2 → `Semi-urgent`, Tier 3 → `Routine`.                                                                            |
| Available Days  |       No | `Dates`, `Available Days`, `Days`                  | `M`, `Mon`, `Monday`, `Tu`, `Tue`, `Tuesday`, `W`, `Wed`, `Wednesday`, `Th`, `Thu`, `Thursday`, `F`, `Fri`, `Friday`, `Any`, blank | Multiple values can be separated by spaces, commas, semicolons, or slashes. Blank or `Any` means any day. Weekends are not supported.                                                  |
| Available Times |       No | `Times`, `Available Times`, `Availability`, `Time` | `8am-12pm`, `8:00am-12:00pm`, `8-12pm`, `1pm-3pm`, `8am to 12pm`, `8am-12pm, 1pm-3pm`, `Any`, blank                                | Multiple time ranges can be separated by commas or semicolons. Blank or `Any` means any time. Times must be within 8:00 AM–6:00 PM and each range must contain at least one full hour. |

## Database

Appointment Manager stores data locally using SQLite. The app saves providers, openings, waitlist entries, scheduled records, and removed records so the data persists after the desktop app is closed.

## Tech Stack

- React
- TypeScript
- Electron
- SQLite
- SheetJS
- CSS

## Future Improvements

- Send automated text messages when scheduling a patient
- Support military time if needed
- Improve scheduling notifications and reminders
